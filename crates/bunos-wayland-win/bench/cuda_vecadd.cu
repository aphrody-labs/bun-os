// SPDX-License-Identifier: Apache-2.0
// CUDA check for the Bun OS WSL distro (docs/WAYLAND-WINDOWS.md, CUDA): device query, pinned-memory bandwidth and a
// vector add timed with events, verified on the host.
//   nvcc -O3 -arch=sm_89 bench/cuda_vecadd.cu -o /tmp/cuda_vecadd && /tmp/cuda_vecadd
#include <cstdio>
#include <cstdlib>
#include <cuda_runtime.h>

#define CHECK(x) do { cudaError_t e = (x); if (e != cudaSuccess) { std::fprintf(stderr, "%s: %s\n", #x, cudaGetErrorString(e)); std::exit(1); } } while (0)

__global__ void vecadd(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}

int main() {
    int dev = 0, drv = 0, rt = 0;
    CHECK(cudaDriverGetVersion(&drv));
    CHECK(cudaRuntimeGetVersion(&rt));
    cudaDeviceProp p;
    CHECK(cudaGetDeviceProperties(&p, dev));
    std::printf("%s: sm_%d%d, %d SMs, %.1f GiB, driver %d.%d, runtime %d.%d\n", p.name, p.major, p.minor,
                p.multiProcessorCount, p.totalGlobalMem / 1073741824.0, drv / 1000, drv % 1000 / 10, rt / 1000, rt % 1000 / 10);

    const int n = 1 << 26;
    const size_t bytes = size_t(n) * sizeof(float);
    float *ha, *hb, *hc, *da, *db, *dc;
    CHECK(cudaMallocHost(&ha, bytes)); CHECK(cudaMallocHost(&hb, bytes)); CHECK(cudaMallocHost(&hc, bytes));
    for (int i = 0; i < n; i++) { ha[i] = float(i % 1000); hb[i] = 2.0f; }
    CHECK(cudaMalloc(&da, bytes)); CHECK(cudaMalloc(&db, bytes)); CHECK(cudaMalloc(&dc, bytes));

    cudaEvent_t t0, t1;
    CHECK(cudaEventCreate(&t0)); CHECK(cudaEventCreate(&t1));
    float ms = 0;
    CHECK(cudaEventRecord(t0));
    CHECK(cudaMemcpy(da, ha, bytes, cudaMemcpyHostToDevice));
    CHECK(cudaMemcpy(db, hb, bytes, cudaMemcpyHostToDevice));
    CHECK(cudaEventRecord(t1)); CHECK(cudaEventSynchronize(t1)); CHECK(cudaEventElapsedTime(&ms, t0, t1));
    double h2d = 2.0 * bytes / (ms / 1e3) / 1e9;

    vecadd<<<(n + 255) / 256, 256>>>(da, db, dc, n);
    CHECK(cudaGetLastError());
    const int reps = 50;
    CHECK(cudaEventRecord(t0));
    for (int r = 0; r < reps; r++) vecadd<<<(n + 255) / 256, 256>>>(da, db, dc, n);
    CHECK(cudaEventRecord(t1)); CHECK(cudaEventSynchronize(t1)); CHECK(cudaEventElapsedTime(&ms, t0, t1));
    double kms = ms / reps, gbs = 3.0 * bytes / (kms / 1e3) / 1e9;

    CHECK(cudaEventRecord(t0));
    CHECK(cudaMemcpy(hc, dc, bytes, cudaMemcpyDeviceToHost));
    CHECK(cudaEventRecord(t1)); CHECK(cudaEventSynchronize(t1)); CHECK(cudaEventElapsedTime(&ms, t0, t1));
    double d2h = bytes / (ms / 1e3) / 1e9;

    long bad = 0;
    for (int i = 0; i < n; i++) if (hc[i] != ha[i] + hb[i]) bad++;
    std::printf("vecadd %d floats: %.3f ms/launch, %.0f GB/s; pinned H2D %.1f GB/s, D2H %.1f GB/s; %s\n", n, kms, gbs,
                h2d, d2h, bad ? "FAIL" : "PASS");
    return bad ? 1 : 0;
}
