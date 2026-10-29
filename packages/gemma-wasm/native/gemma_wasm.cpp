// SPDX-License-Identifier: Apache-2.0
// Gemma on llama.cpp/ggml compiled to WebAssembly: one source for the Emscripten module
// (browser worker, Bun/Node) and the WASI command (wasmtime, node:wasi).
// Built against the llama.cpp release pinned in PIN (see ../build/pin.json).
#include "llama.h"

#include <chrono>
#include <clocale>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define GW_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define GW_EXPORT extern "C"
#endif

namespace {

struct Session {
    llama_model *   model = nullptr;
    llama_context * ctx   = nullptr;
    const llama_vocab * vocab = nullptr;
    int n_ctx = 0;
};
Session g;

using clock_type = std::chrono::steady_clock;
double ms_since(clock_type::time_point t) {
    return std::chrono::duration<double, std::milli>(clock_type::now() - t).count();
}

void set_tokens(llama_batch_ext * b, const llama_token * tok, int32_t n, llama_pos pos0) {
    llama_batch_ext_clear(b);
    for (int32_t i = 0; i < n; ++i) {
        const int32_t idx = llama_batch_ext_add_token(b, 0, tok[i]);
        const llama_pos pos = pos0 + i;
        llama_batch_ext_set_pos(b, idx, &pos);
    }
    llama_batch_ext_set_output_logits(b, n - 1, true);
}

std::string last_stats = "{}";

}  // namespace

// Load a GGUF from the (virtual) filesystem. Returns 0 on success.
GW_EXPORT int gw_load(const char * path, int n_ctx, int n_threads) {
    std::setlocale(LC_NUMERIC, "C");
    llama_log_set([](ggml_log_level lvl, const char * text, void *) {
        if (lvl >= GGML_LOG_LEVEL_WARN) fputs(text, stderr);
    }, nullptr);
    llama_backend_init();
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    mp.use_mmap = false;  // Emscripten MEMFS/WORKERFS: read straight into the heap instead of emulated mmap
    g.model = llama_model_load_from_file(path, mp);
    if (!g.model) return 1;
    g.vocab = llama_model_get_vocab(g.model);
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = n_ctx;
    cp.n_batch = 256;
    cp.n_ubatch = 256;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    cp.no_perf = false;
    g.ctx = llama_init_from_model(g.model, cp);
    if (!g.ctx) return 2;
    g.n_ctx = n_ctx;
    return 0;
}

// Called for every decoded piece (UTF-8, may be a partial multi-byte sequence). Return non-zero to stop.
typedef int (*gw_token_cb)(const char * piece, int len, void * user);

// Greedy when temp <= 0, otherwise top-k 64 / top-p 0.95 / temperature sampling. Returns generated token count
// or a negative error code. Statistics of the last run are available from gw_stats().
GW_EXPORT int gw_generate(const char * prompt, int max_tokens, float temp, unsigned seed, gw_token_cb cb, void * user) {
    if (!g.ctx) return -1;
    llama_memory_clear(llama_get_memory(g.ctx), true);
    const std::string p = prompt;
    const int n_prompt = -llama_tokenize(g.vocab, p.c_str(), p.size(), nullptr, 0, /*add_special*/ false, /*parse_special*/ true);
    std::vector<llama_token> toks(n_prompt);
    if (llama_tokenize(g.vocab, p.c_str(), p.size(), toks.data(), toks.size(), false, true) < 0) return -2;
    if (n_prompt + max_tokens > g.n_ctx) max_tokens = g.n_ctx - n_prompt;
    if (max_tokens <= 0) return -3;

    llama_sampler_chain_params sp = llama_sampler_chain_default_params();
    sp.no_perf = true;
    llama_sampler * smpl = llama_sampler_chain_init(sp);
    if (temp <= 0.f) llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    else {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(64));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed));
    }

    llama_batch_ext * batch = llama_batch_ext_init(g.ctx);
    const auto t0 = clock_type::now();
    double t_first = 0;
    int n_gen = 0;
    int pos = 0;
    int rc = 0;
    // prefill in n_batch chunks
    for (int i = 0; i < n_prompt; i += 256) {
        const int n = std::min(256, n_prompt - i);
        std::vector<llama_token> chunk(toks.begin() + i, toks.begin() + i + n);
        set_tokens(batch, chunk.data(), n, pos);
        if (llama_process(g.ctx, LLAMA_PROCESS_TYPE_DECODE, batch)) { rc = -4; break; }
        pos += n;
    }
    const double t_prefill = ms_since(t0);
    const auto t1 = clock_type::now();
    while (rc == 0 && n_gen < max_tokens) {
        llama_token id = llama_sampler_sample(smpl, g.ctx, -1);
        if (llama_vocab_is_eog(g.vocab, id)) break;
        char buf[256];
        const int n = llama_token_to_piece(g.vocab, id, buf, sizeof(buf), 0, /*special*/ false);
        if (n < 0) { rc = -5; break; }
        if (!n_gen) t_first = ms_since(t0);
        ++n_gen;
        if (cb && n > 0 && cb(buf, n, user)) break;
        set_tokens(batch, &id, 1, pos++);
        if (llama_process(g.ctx, LLAMA_PROCESS_TYPE_DECODE, batch)) { rc = -4; break; }
    }
    const double t_decode = ms_since(t1);
    char js[320];
    snprintf(js, sizeof js,
             "{\"prompt_tokens\":%d,\"completion_tokens\":%d,\"prefill_ms\":%.1f,\"ttft_ms\":%.1f,\"decode_ms\":%.1f,"
             "\"decode_tps\":%.3f,\"prefill_tps\":%.3f}",
             n_prompt, n_gen, t_prefill, t_first, t_decode,
             n_gen > 1 ? (n_gen - 1) * 1000.0 / (t_decode - (t_first - t_prefill)) : 0.0,
             t_prefill > 0 ? n_prompt * 1000.0 / t_prefill : 0.0);
    last_stats = js;
    llama_batch_ext_free(batch);
    llama_sampler_free(smpl);
    return rc ? rc : n_gen;
}

GW_EXPORT const char * gw_stats() { return last_stats.c_str(); }

GW_EXPORT int gw_tokenize_count(const char * text) {
    if (!g.vocab) return -1;
    return -llama_tokenize(g.vocab, text, strlen(text), nullptr, 0, false, true);
}

GW_EXPORT void gw_free() {
    if (g.ctx) llama_free(g.ctx);
    if (g.model) llama_model_free(g.model);
    g = Session{};
}

#ifndef GW_NO_MAIN
// Command line for WASI / node: gemma.wasm -m model.gguf [-n 64] [-c 2048] [-t 4] [-T temp] [-s seed] "prompt"
// The prompt is wrapped in the Gemma 4 turn format unless --raw is given.
static int print_piece(const char * s, int n, void *) {
    fwrite(s, 1, n, stdout);
    fflush(stdout);
    return 0;
}

int main(int argc, char ** argv) {
    std::string model, prompt = "Explain in two sentences why the sky is blue.";
    int n = 64, ctx = 2048, thr = 1;
    float temp = 0.f;
    unsigned seed = 1;
    bool raw = false;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "-m" && i + 1 < argc) model = argv[++i];
        else if (a == "-n" && i + 1 < argc) n = atoi(argv[++i]);
        else if (a == "-c" && i + 1 < argc) ctx = atoi(argv[++i]);
        else if (a == "-t" && i + 1 < argc) thr = atoi(argv[++i]);
        else if (a == "-T" && i + 1 < argc) temp = (float) atof(argv[++i]);
        else if (a == "-s" && i + 1 < argc) seed = (unsigned) atoi(argv[++i]);
        else if (a == "--raw") raw = true;
        else prompt = a;
    }
    if (model.empty()) {
        fprintf(stderr, "usage: %s -m model.gguf [-n N] [-c CTX] [-t THREADS] [-T TEMP] [-s SEED] [--raw] PROMPT\n", argv[0]);
        return 2;
    }
    const auto t0 = clock_type::now();
    if (int rc = gw_load(model.c_str(), ctx, thr)) { fprintf(stderr, "load failed: %d\n", rc); return 1; }
    fprintf(stderr, "{\"load_ms\":%.1f}\n", ms_since(t0));
    if (!raw) prompt = "<bos><|turn>user\n" + prompt + "<turn|>\n<|turn>model\n";
    int r = gw_generate(prompt.c_str(), n, temp, seed, print_piece, nullptr);
    printf("\n");
    fprintf(stderr, "%s\n", gw_stats());
    gw_free();
    return r < 0 ? 1 : 0;
}
#endif
