/*
 * ntcore freestanding libc subset for wasm32-unknown-unknown (no wasi-libc): allocator, mem*, str*, stubs the
 * ReactOS objects reference. Requires -mbulk-memory. Licensed GPL-2.0-or-later together with the ReactOS objects.
 */
typedef unsigned int size_t;
typedef unsigned long long u64;

void *memcpy(void *d, const void *s, size_t n) { return __builtin_memcpy(d, s, n); }
void *memmove(void *d, const void *s, size_t n) { return __builtin_memmove(d, s, n); }
void *memset(void *d, int c, size_t n) { return __builtin_memset(d, c, n); }
int memcmp(const void *a, const void *b, size_t n) {
  const unsigned char *x = a, *y = b;
  for (size_t i = 0; i < n; i++) if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
size_t strlen(const char *s) { size_t n = 0; while (s[n]) n++; return n; }
int strcmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (unsigned char)*a - (unsigned char)*b; }
int strncmp(const char *a, const char *b, size_t n) {
  for (; n; n--, a++, b++) { if (*a != *b) return (unsigned char)*a - (unsigned char)*b; if (!*a) break; }
  return 0;
}
static int lc(int c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }
int strcasecmp(const char *a, const char *b) { while (*a && lc(*a) == lc(*b)) { a++; b++; } return lc((unsigned char)*a) - lc((unsigned char)*b); }
int strncasecmp(const char *a, const char *b, size_t n) {
  for (; n; n--, a++, b++) { if (lc(*a) != lc(*b)) return lc((unsigned char)*a) - lc((unsigned char)*b); if (!*a) break; }
  return 0;
}
char *strchr(const char *s, int c) { for (;; s++) { if (*s == (char)c) return (char *)s; if (!*s) return 0; } }
char *strcpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++)) {} return r; }
char *strncpy(char *d, const char *s, size_t n) { size_t i = 0; for (; i < n && s[i]; i++) d[i] = s[i]; for (; i < n; i++) d[i] = 0; return d; }
int abs(int x) { return x < 0 ? -x : x; }
void abort(void) { __builtin_trap(); }
void exit(int c) { (void)c; __builtin_trap(); }
int printf(const char *f, ...) { (void)f; return 0; }
int snprintf(char *b, unsigned n, const char *f, ...) { (void)f; if (n) b[0] = 0; return 0; }
int __stdio_common_vsprintf(u64 o, char *b, size_t n, const char *f, void *l, void *a) { (void)o; (void)f; (void)l; (void)a; if (n) b[0] = 0; return 0; }
static u64 stdio_opts;
u64 *__local_stdio_printf_options(void) { return &stdio_opts; }

/* Allocator: 16-byte header (size), power-of-two size classes with free lists, memory.grow for fresh space. */
extern unsigned char __heap_base;
static unsigned char *brk_ptr;
static unsigned char *brk_end;
#define NCLASS 28
static void *freelist[NCLASS];
static unsigned classof(size_t n) { unsigned c = 4; while (((size_t)1 << c) < n && c < NCLASS - 1) c++; return c; }

void *malloc(size_t n) {
  if (!n) n = 1;
  unsigned c = classof(n + 16);
  if (freelist[c]) { void *p = freelist[c]; freelist[c] = *(void **)p; return p; }
  size_t sz = (size_t)1 << c;
  if (!brk_ptr) { brk_ptr = (unsigned char *)(((size_t)&__heap_base + 15) & ~15u); brk_end = (unsigned char *)(__builtin_wasm_memory_size(0) * 65536u); }
  if (brk_ptr + sz > brk_end) {
    size_t need = (size_t)(brk_ptr + sz - brk_end);
    size_t pages = (need + 65535) / 65536;
    if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
    brk_end += pages * 65536u;
  }
  unsigned *h = (unsigned *)brk_ptr; brk_ptr += sz;
  h[0] = c;
  return (void *)(h + 4);
}
void free(void *p) {
  if (!p) return;
  unsigned c = ((unsigned *)p)[-4];
  *(void **)p = freelist[c];
  freelist[c] = p;
}
