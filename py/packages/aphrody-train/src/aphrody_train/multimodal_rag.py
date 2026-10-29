# SPDX-License-Identifier: Apache-2.0
"""Multimodal RAG indexing, evaluation, and continuous GPU loop for Dragon Ball data."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import click

logger = logging.getLogger(__name__)


class MultimodalDoc:
    """Document unifying text, image plate references, and canonical metadata."""

    def __init__(
        self,
        doc_id: str,
        title: str,
        content: str,
        image_ref: str | None = None,
        kind: str = "databook",
        lang: str = "fr",
        entity: str | None = None,
    ):
        self.doc_id = doc_id
        self.title = title
        self.content = content
        self.image_ref = image_ref
        self.kind = kind
        self.lang = lang
        self.entity = entity

    def to_embedding_text(self) -> str:
        """Compose a unified multimodal passage text representation for E5."""
        parts = [f"title: {self.title}"]
        if self.image_ref:
            parts.append(f"plate: {self.image_ref}")
        if self.entity:
            parts.append(f"entity: {self.entity}")
        parts.append(f"text: {self.content}")
        return " | ".join(parts)


def load_multimodal_corpus(
    corpus_jsonl: str, lots_dir: str | None = None, max_docs: int | None = None
) -> list[MultimodalDoc]:
    """Load unified corpus and enrich with OCR lot image references."""
    docs: list[MultimodalDoc] = []
    corpus_path = Path(corpus_jsonl)
    if not corpus_path.is_file():
        raise FileNotFoundError(f"Corpus file not found: {corpus_jsonl}")

    image_map: dict[str, str] = {}
    if lots_dir and Path(lots_dir).is_dir():
        for lot_file in Path(lots_dir).glob("databooks-lot-*.jsonl"):
            with open(lot_file, encoding="utf-8") as f:
                for source_line in f:
                    line = source_line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        img = obj.get("image")
                        if img:
                            # e.g. "1-15.jpg" -> databook 1, plate 15
                            base = Path(img).stem
                            image_map[base] = img
                    except (ValueError, TypeError, AttributeError) as exc:
                        raise ValueError(
                            f"Invalid OCR lot record in {lot_file}: {exc}"
                        ) from exc

    with open(corpus_path, encoding="utf-8") as f:
        for idx, source_line in enumerate(f):
            if max_docs and idx >= max_docs:
                break
            line = source_line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                doc_id = row.get("id", f"doc-{idx}")
                title = row.get("name") or row.get("title") or doc_id
                content = row.get("markdown") or row.get("content") or ""
                url = row.get("url", "")
                kind = row.get("kind", "databook")
                lang = row.get("lang", "fr")
                entity = row.get("entity")

                # Resolve image reference from url or id
                image_ref = None
                if "#planche-" in url:
                    # url like <site>/wiki/databooks/4#planche-127
                    parts = url.split("/databooks/")
                    if len(parts) > 1:
                        book_part = parts[1].split("#planche-")
                        if len(book_part) == 2:
                            key = f"{book_part[0]}-{book_part[1]}"
                            image_ref = image_map.get(key, f"{key}.jpg")

                docs.append(
                    MultimodalDoc(
                        doc_id=doc_id,
                        title=title,
                        content=content,
                        image_ref=image_ref,
                        kind=kind,
                        lang=lang,
                        entity=entity,
                    )
                )
            except (ValueError, TypeError, AttributeError) as exc:
                raise ValueError(
                    f"Invalid corpus record in {corpus_path} at line {idx + 1}: {exc}"
                ) from exc

    return docs


class GpuRagEngine:
    """Accelerated RAG search and evaluation loop utilizing NVIDIA GPU with CUDA."""

    def __init__(
        self,
        embed_model_path: str,
        rerank_model_path: str | None = None,
        device: str = "cuda",
    ):
        try:
            import numpy
            import torch
            from sentence_transformers import CrossEncoder, SentenceTransformer

            self.torch = torch
            self.numpy = numpy
            self.has_cuda = torch.cuda.is_available() and device == "cuda"
            self.device = "cuda" if self.has_cuda else "cpu"
            logger.info(f"[GpuRagEngine] Initializing on device: {self.device.upper()}")
            if self.has_cuda:
                gpu_name = torch.cuda.get_device_name(0)
                vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                logger.info(f"  * GPU: {gpu_name} ({vram_gb:.1f} GB VRAM)")

            self.embedder = SentenceTransformer(embed_model_path, device=self.device)
            self.reranker = (
                CrossEncoder(rerank_model_path, device=self.device)
                if rerank_model_path
                else None
            )
            self.corpus_docs: list[MultimodalDoc] = []
            self.corpus_embeddings: Any | None = None
        except (ImportError, OSError, ValueError, RuntimeError) as exc:
            raise RuntimeError(f"Failed to initialize GpuRagEngine: {exc}") from exc

    def index_corpus(self, docs: list[MultimodalDoc], batch_size: int = 64) -> None:
        """Encode all multimodal documents into dense normalized vectors."""
        self.corpus_docs = docs
        texts = [f"passage: {doc.to_embedding_text()}" for doc in docs]
        logger.info(
            f"[GpuRagEngine] Encoding {len(texts)} multimodal passages on {self.device.upper()}..."
        )
        start = time.perf_counter()
        embeddings = self.embedder.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        elapsed = time.perf_counter() - start
        self.corpus_embeddings = embeddings
        rate = len(texts) / elapsed if elapsed > 0 else 0
        logger.info(
            f"[GpuRagEngine] Indexed {len(texts)} documents in {elapsed:.2f}s ({rate:.1f} docs/sec)"
        )

    def search(
        self, query: str, top_k: int = 10, rerank: bool = True
    ) -> list[dict[str, Any]]:
        """Dense similarity vector search followed by optional cross-encoder reranking."""
        if self.corpus_embeddings is None or not self.corpus_docs:
            raise RuntimeError("Corpus not indexed yet")

        query_text = f"query: {query}"
        query_vec = self.embedder.encode(
            [query_text], normalize_embeddings=True, convert_to_numpy=True
        )[0]

        # Cosine similarity (already normalized vectors: dot product)
        scores = self.numpy.dot(self.corpus_embeddings, query_vec)
        top_indices = self.numpy.argsort(scores)[::-1][: top_k * 3]

        candidates = []
        for idx in top_indices:
            candidates.append(
                {
                    "doc": self.corpus_docs[idx],
                    "vector_score": float(scores[idx]),
                }
            )

        if rerank and self.reranker:
            pairs = [(query, item["doc"].to_embedding_text()) for item in candidates]
            rerank_scores = self.reranker.predict(pairs)
            for idx, score in enumerate(rerank_scores):
                candidates[idx]["final_score"] = float(score)
            candidates.sort(key=lambda x: x["final_score"], reverse=True)
        else:
            for item in candidates:
                item["final_score"] = item["vector_score"]

        results = []
        for item in candidates[:top_k]:
            doc: MultimodalDoc = item["doc"]
            results.append(
                {
                    "id": doc.doc_id,
                    "title": doc.title,
                    "image_ref": doc.image_ref,
                    "kind": doc.kind,
                    "lang": doc.lang,
                    "snippet": doc.content[:200],
                    "score": item["final_score"],
                }
            )
        return results

    def run_benchmark_loop(
        self,
        queries: list[str],
        iterations: int = 10,
        top_k: int = 5,
        rerank: bool = True,
    ) -> dict[str, Any]:
        """Continuous execution loop on GPU measuring latency, QPS, and throughput."""
        logger.info(
            f"\n[GpuRagEngine] Starting continuous GPU loop: {iterations} iterations over {len(queries)} queries..."
        )
        total_queries = 0
        latencies: list[float] = []

        start_time = time.perf_counter()
        for it in range(iterations):
            for q in queries:
                t0 = time.perf_counter()
                self.search(q, top_k=top_k, rerank=rerank)
                dt = (time.perf_counter() - t0) * 1000.0  # ms
                latencies.append(dt)
                total_queries += 1

            if (it + 1) % max(1, iterations // 5) == 0:
                recent_p50 = self.numpy.percentile(latencies[-len(queries) :], 50)
                logger.info(
                    f"  * Iteration {it + 1}/{iterations} — Median latency: {recent_p50:.2f} ms"
                )

        total_elapsed = time.perf_counter() - start_time
        qps = total_queries / total_elapsed if total_elapsed > 0 else 0

        vram_allocated_mb = 0.0
        if self.has_cuda and hasattr(self.torch.cuda, "memory_allocated"):
            vram_allocated_mb = self.torch.cuda.memory_allocated(0) / (1024**2)

        stats = {
            "total_queries": total_queries,
            "total_elapsed_secs": round(total_elapsed, 2),
            "qps": round(qps, 2),
            "latency_p50_ms": round(float(self.numpy.percentile(latencies, 50)), 2),
            "latency_p95_ms": round(float(self.numpy.percentile(latencies, 95)), 2),
            "latency_p99_ms": round(float(self.numpy.percentile(latencies, 99)), 2),
            "vram_allocated_mb": round(vram_allocated_mb, 2),
            "device": self.device,
        }
        logger.info("\n=== Bilan de la Boucle RAG GPU ===")
        logger.info(f"  * Total requêtes :     {stats['total_queries']}")
        logger.info(f"  * Débit (QPS) :        {stats['qps']} req/sec")
        logger.info(f"  * Latence p50 :        {stats['latency_p50_ms']} ms")
        logger.info(f"  * Latence p95 :        {stats['latency_p95_ms']} ms")
        logger.info(f"  * VRAM allouée :       {stats['vram_allocated_mb']} Mo")
        return stats


@click.group()
def cli():
    """Multimodal RAG & GPU Training Suite."""
    pass


@cli.command()
@click.option(
    "--corpus",
    required=True,
    type=click.Path(exists=True, dir_okay=False),
    help="Path to corpus JSONL",
)
@click.option(
    "--lots-dir",
    default=None,
    type=click.Path(exists=True, file_okay=False),
    help="Path to databooks lots dir",
)
@click.option(
    "--embed-model",
    required=True,
    type=click.Path(exists=True),
    help="Embedding model path",
)
@click.option(
    "--rerank-model",
    default=None,
    type=click.Path(exists=True),
    help="Reranker model path",
)
@click.option("--max-docs", default=5000, type=int, help="Max documents to load")
@click.option(
    "--iterations", default=5, type=int, help="Number of benchmark iterations"
)
@click.option("--no-rerank", is_flag=True, default=False, help="Disable cross-encoder")
def loop(
    corpus: str,
    lots_dir: str,
    embed_model: str,
    rerank_model: str,
    max_docs: int,
    iterations: int,
    no_rerank: bool,
):
    """Run multimodal RAG in continuous loop on NVIDIA GPU."""
    docs = load_multimodal_corpus(corpus, lots_dir, max_docs=max_docs)
    print(f"Loaded {len(docs)} multimodal documents from {corpus}")

    engine = GpuRagEngine(
        embed_model_path=embed_model,
        rerank_model_path=None if no_rerank else rerank_model,
        device="cuda",
    )
    engine.index_corpus(docs, batch_size=64)

    test_queries = [
        "Kamehameha origine technique Kamé Sennin",
        "Genkidama énergie Kaio du Nord",
        "Super Saiyan légende transformation cheveux dorés",
        "Daizenshuu 7 Dragon Ball Daijiten techniques de combat",
        "V-Jump guide cartes fusion Gogeta Vegetto",
    ]

    stats = engine.run_benchmark_loop(
        test_queries, iterations=iterations, rerank=not no_rerank
    )

    out_file = Path("home/aphrody/rag_gpu_stats.json")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(f"\nStats recorded in: {out_file}")


if __name__ == "__main__":
    cli()
