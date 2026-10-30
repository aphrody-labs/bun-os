/*
 * ntcore: wasm32 host glue for ReactOS cmlib (the Configuration Manager hive library used by the NT kernel, the
 * boot loader and mkhive). Built with CMLIB_HOST like sdk/tools/mkhive; the hive is read through the same
 * HvInitialize(HINIT_FILE) path the kernel uses, with FileRead served from a memory image.
 * GPL-2.0-or-later (links ReactOS sdk/lib/cmlib).
 */
#include "cmlib.h"

#define EXPORT(n) __attribute__((export_name(n)))
#define NT_NIL 0xFFFFFFFFu

void *malloc(size_t);
void free(void *);
void *calloc(size_t, size_t);

/* ---- host services cmlib expects (mkhive/rtl.c equivalents) ---- */
VOID NTAPI RtlInitUnicodeString(PUNICODE_STRING d, PCWSTR s) {
  SIZE_T n = 0;
  if (s) {
    while (s[n]) n++;
    d->Length = (USHORT)(n * 2);
    d->MaximumLength = (USHORT)(n * 2 + 2);
  } else d->Length = d->MaximumLength = 0;
  d->Buffer = (PWCHAR)s;
}
WCHAR NTAPI RtlUpcaseUnicodeChar(WCHAR c) {
  if (c < 'a') return c;
  if (c <= 'z') return c - 32;
  if (c < 0xE0) return c;                                      /* Latin-1 */
  if (c <= 0xFE && c != 0xF7) return c - 32;
  if (c == 0xFF) return 0x178;
  if (c >= 0x3B1 && c <= 0x3C9 && c != 0x3C2) return c - 32;   /* Greek */
  if (c >= 0x430 && c <= 0x44F) return c - 32;                 /* Cyrillic */
  if (c >= 0x450 && c <= 0x45F) return c - 80;
  return c;
}
LONG NTAPI RtlCompareUnicodeString(PCUNICODE_STRING a, PCUNICODE_STRING b, BOOLEAN ci) {
  USHORT i, na = a->Length / 2, nb = b->Length / 2, n = na < nb ? na : nb;
  for (i = 0; i < n; i++) {
    WCHAR x = a->Buffer[i], y = b->Buffer[i];
    if (ci) { x = RtlUpcaseUnicodeChar(x); y = RtlUpcaseUnicodeChar(y); }
    if (x != y) return x < y ? -1 : 1;
  }
  return na == nb ? 0 : (na < nb ? -1 : 1);
}
VOID NTAPI KeQuerySystemTime(PLARGE_INTEGER t) { t->QuadPart = 0; }
VOID NTAPI KeBugCheckEx(ULONG c, ULONG_PTR a, ULONG_PTR b, ULONG_PTR d, ULONG_PTR e) {
  (void)c; (void)a; (void)b; (void)d; (void)e;
  __builtin_trap();
}

#include "ntcore_bitmap.h"

PVOID NTAPI CmpAllocate(SIZE_T size, BOOLEAN paged, ULONG tag) { (void)paged; (void)tag; return malloc((size_t)size); }
VOID NTAPI CmpFree(PVOID p, ULONG quota) { (void)quota; free(p); }

/* ---- memory-backed "file" ---- */
typedef struct { CMHIVE h; const unsigned char *img; ULONG len; } NTHIVE;
static NTHIVE *hives[32];

static BOOLEAN NTAPI fread_cb(PHHIVE hv, ULONG type, PULONG off, PVOID buf, SIZE_T n) {
  NTHIVE *x = (NTHIVE *)hv;
  (void)type;
  if ((ULONG)*off > x->len || n > x->len - *off) return FALSE;
  __builtin_memcpy(buf, x->img + *off, n);
  return TRUE;
}
static BOOLEAN NTAPI fwrite_cb(PHHIVE hv, ULONG t, PULONG o, PVOID b, SIZE_T n) { (void)hv; (void)t; (void)o; (void)b; (void)n; return FALSE; }
static BOOLEAN NTAPI fsize_cb(PHHIVE hv, ULONG t, ULONG s, ULONG o) { (void)hv; (void)t; (void)s; (void)o; return FALSE; }
static BOOLEAN NTAPI fflush_cb(PHHIVE hv, ULONG t, PLARGE_INTEGER o, ULONG l) { (void)hv; (void)t; (void)o; (void)l; return FALSE; }

static NTHIVE *get(int id) { return (id > 0 && id < 32) ? hives[id] : 0; }

EXPORT("nt_malloc") void *nt_malloc(unsigned n) { return malloc(n); }
EXPORT("nt_free") void nt_free(void *p) { free(p); }

/* Returns hive id (>0) or the NTSTATUS (negative) of the failure. The image is copied; the caller may free it. */
EXPORT("nt_hive_open") int nt_hive_open(const unsigned char *img, unsigned len) {
  int id;
  NTHIVE *x;
  NTSTATUS st;
  for (id = 1; id < 32 && hives[id]; id++) {}
  if (id == 32) return (int)STATUS_INSUFFICIENT_RESOURCES;
  x = calloc(1, sizeof *x);
  if (!x) return (int)STATUS_NO_MEMORY;
  x->img = malloc(len ? len : 1);
  if (!x->img) { free(x); return (int)STATUS_NO_MEMORY; }
  __builtin_memcpy((void *)x->img, img, len);
  x->len = len;
  st = HvInitialize(&x->h.Hive, HINIT_FILE, 0, HFILE_TYPE_PRIMARY, 0, CmpAllocate, CmpFree, fsize_cb, fwrite_cb,
                    fread_cb, fflush_cb, 1, NULL);
  if (st != STATUS_SUCCESS) { free((void *)x->img); free(x); return (int)st; }
  hives[id] = x;
  return id;
}
EXPORT("nt_hive_close") void nt_hive_close(int id) {
  NTHIVE *x = get(id);
  if (!x) return;
  HvFree(&x->h.Hive);
  free((void *)x->img);
  free(x);
  hives[id] = 0;
}
/* CM_CHECK_REGISTRY_* code from the kernel's own consistency checker (0 = good). */
EXPORT("nt_hive_check") unsigned nt_hive_check(int id) {
  NTHIVE *x = get(id);
  return x ? (unsigned)CmCheckRegistry(&x->h, CM_CHECK_REGISTRY_VALIDATE_HIVE) : 0xFFFFu;
}
EXPORT("nt_hive_version") unsigned nt_hive_version(int id) { NTHIVE *x = get(id); return x ? x->h.Hive.Version : 0; }
EXPORT("nt_hive_root") unsigned nt_hive_root(int id) { NTHIVE *x = get(id); return x ? x->h.Hive.BaseBlock->RootCell : NT_NIL; }

static PCM_KEY_NODE node(NTHIVE *x, HCELL_INDEX c) {
  if (c == HCELL_NIL || !HvIsCellAllocated(&x->h.Hive, c)) return 0;
  return (PCM_KEY_NODE)HvGetCell(&x->h.Hive, c);
}
/* Walk a backslash separated UTF-16 path from `start` (NT_NIL = root). Returns the key cell or NT_NIL. */
EXPORT("nt_key_open") unsigned nt_key_open(int id, unsigned start, const WCHAR *p, unsigned n) {
  NTHIVE *x = get(id);
  HCELL_INDEX cell;
  unsigned i = 0;
  if (!x) return NT_NIL;
  cell = start == NT_NIL ? x->h.Hive.BaseBlock->RootCell : start;
  while (i < n) {
    UNICODE_STRING s;
    HCELL_INDEX next;
    PCM_KEY_NODE nd;
    while (i < n && p[i] == '\\') i++;
    if (i >= n) break;
    s.Buffer = (PWCHAR)p + i;
    while (i < n && p[i] != '\\') i++;
    s.Length = s.MaximumLength = (USHORT)(((PWCHAR)p + i - s.Buffer) * 2);
    nd = node(x, cell);
    if (!nd) return NT_NIL;
    next = CmpFindSubKeyByName(&x->h.Hive, nd, &s);
    if (next == HCELL_NIL) return NT_NIL;
    cell = next;
  }
  return cell;
}
/* out[0..5] = subkeys, values, lastWrite lo, lastWrite hi, name chars, flags */
EXPORT("nt_key_info") int nt_key_info(int id, unsigned cell, unsigned *out) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE n;
  if (!x || !(n = node(x, cell)) || n->Signature != CM_KEY_NODE_SIGNATURE) return -1;
  out[0] = n->SubKeyCounts[Stable];
  out[1] = n->ValueList.Count;
  out[2] = n->LastWriteTime.LowPart;
  out[3] = (unsigned)n->LastWriteTime.HighPart;
  out[4] = (n->Flags & KEY_COMP_NAME) ? n->NameLength : n->NameLength / 2;
  out[5] = n->Flags;
  return 0;
}
static unsigned copyname(const void *name, USHORT len, int comp, WCHAR *out, unsigned cap) {
  unsigned i, chars = comp ? len : len / 2;
  for (i = 0; i < chars && i < cap; i++) out[i] = comp ? ((const unsigned char *)name)[i] : ((const WCHAR *)name)[i];
  return chars;
}
EXPORT("nt_key_name") int nt_key_name(int id, unsigned cell, WCHAR *out, unsigned cap) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE n;
  if (!x || !(n = node(x, cell))) return -1;
  return (int)copyname(n->Name, n->NameLength, n->Flags & KEY_COMP_NAME, out, cap);
}
EXPORT("nt_key_parent") unsigned nt_key_parent(int id, unsigned cell) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE n = x ? node(x, cell) : 0;
  return n ? n->Parent : NT_NIL;
}
EXPORT("nt_key_subkey") unsigned nt_key_subkey(int id, unsigned cell, unsigned idx) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE n = x ? node(x, cell) : 0;
  return n ? CmpFindSubKeyByNumber(&x->h.Hive, n, idx) : NT_NIL;
}
EXPORT("nt_key_value") unsigned nt_key_value(int id, unsigned cell, unsigned idx) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE n = x ? node(x, cell) : 0;
  HCELL_INDEX *list;
  if (!n || idx >= n->ValueList.Count || n->ValueList.List == HCELL_NIL) return NT_NIL;
  list = (HCELL_INDEX *)HvGetCell(&x->h.Hive, n->ValueList.List);
  return list ? list[idx] : NT_NIL;
}
EXPORT("nt_value_find") unsigned nt_value_find(int id, unsigned cell, const WCHAR *p, unsigned n) {
  NTHIVE *x = get(id);
  PCM_KEY_NODE nd = x ? node(x, cell) : 0;
  UNICODE_STRING s;
  ULONG idx;
  HCELL_INDEX v = HCELL_NIL;
  if (!nd) return NT_NIL;
  s.Buffer = (PWCHAR)p;
  s.Length = s.MaximumLength = (USHORT)(n * 2);
  return CmpFindNameInList(&x->h.Hive, &nd->ValueList, &s, &idx, &v) && v != HCELL_NIL ? v : NT_NIL;
}
/* out[0..3] = type, data length, name chars, data pointer (valid until the hive is closed) */
EXPORT("nt_value_info") int nt_value_info(int id, unsigned vcell, unsigned *out) {
  NTHIVE *x = get(id);
  PCM_KEY_VALUE v;
  ULONG len = 0;
  PVOID data;
  if (!x || vcell == HCELL_NIL || !HvIsCellAllocated(&x->h.Hive, vcell)) return -1;
  v = (PCM_KEY_VALUE)HvGetCell(&x->h.Hive, vcell);
  if (!v || v->Signature != CM_KEY_VALUE_SIGNATURE) return -1;
  data = CmpValueToData(&x->h.Hive, v, &len);
  out[0] = v->Type;
  out[1] = len;
  out[2] = (v->Flags & VALUE_COMP_NAME) ? v->NameLength : v->NameLength / 2;
  out[3] = (unsigned)(ULONG_PTR)data;
  return 0;
}
EXPORT("nt_value_name") int nt_value_name(int id, unsigned vcell, WCHAR *out, unsigned cap) {
  NTHIVE *x = get(id);
  PCM_KEY_VALUE v;
  if (!x || vcell == HCELL_NIL) return -1;
  v = (PCM_KEY_VALUE)HvGetCell(&x->h.Hive, vcell);
  return v ? (int)copyname(v->Name, v->NameLength, v->Flags & VALUE_COMP_NAME, out, cap) : -1;
}
