/* ntcore libc part 2: calloc/realloc on top of libc.c malloc. */
typedef unsigned int size_t;
void *malloc(size_t);
void free(void *);
void *memset(void *, int, size_t);
void *memcpy(void *, const void *, size_t);

void *calloc(size_t a, size_t b) {
  void *p = malloc(a * b);
  if (p) memset(p, 0, a * b);
  return p;
}
void *realloc(void *p, size_t n) {
  unsigned c;
  size_t old;
  void *q;
  if (!p) return malloc(n);
  c = ((unsigned *)p)[-4];
  old = ((size_t)1 << c) - 16;
  if (n <= old) return p;
  q = malloc(n);
  if (!q) return 0;
  memcpy(q, p, old);
  free(p);
  return q;
}
