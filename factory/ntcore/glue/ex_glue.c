/*
 * ntcore: wasm32 glue around the ReactOS Executive handle table (ntoskrnl/ex/handle.c, the 3-level table behind
 * every NT process handle) and the RTL image helpers (sdk/lib/rtl/image.c). The single wasm thread makes push
 * locks and critical regions no-ops. GPL-2.0-or-later (links ReactOS ntoskrnl/ex/handle.c, sdk/lib/rtl/image.c).
 */
#include <ntoskrnl.h>

#define EXPORT(n) __attribute__((export_name(n)))

void *calloc(size_t, size_t);
void free(void *);

/* ---- kernel services handle.c needs ---- */
PVOID NTAPI ExAllocatePoolWithTag(POOL_TYPE t, SIZE_T n, ULONG tag) { (void)t; (void)tag; return calloc(1, (size_t)n); }
VOID NTAPI ExFreePoolWithTag(PVOID p, ULONG tag) { (void)tag; free(p); }
VOID FASTCALL ExfAcquirePushLockExclusive(PEX_PUSH_LOCK l) { (void)l; }
VOID FASTCALL ExfAcquirePushLockShared(PEX_PUSH_LOCK l) { (void)l; }
VOID FASTCALL ExfReleasePushLockExclusive(PEX_PUSH_LOCK l) { (void)l; }
VOID FASTCALL ExfReleasePushLockShared(PEX_PUSH_LOCK l) { (void)l; }
VOID FASTCALL ExfTryToWakePushLock(PEX_PUSH_LOCK l) { (void)l; }
VOID FASTCALL ExfUnblockPushLock(PEX_PUSH_LOCK l, PVOID w) { (void)l; (void)w; }
VOID FASTCALL ExBlockPushLock(PEX_PUSH_LOCK l, PVOID w) { (void)l; (void)w; }
VOID FASTCALL ExWaitForUnblockPushLock(PEX_PUSH_LOCK l, PVOID w) { (void)l; (void)w; }
VOID FASTCALL KiCheckForKernelApcDelivery(VOID) {}
NTSTATUS NTAPI PsChargeProcessPagedPoolQuota(PEPROCESS p, SIZE_T n) { (void)p; (void)n; return STATUS_SUCCESS; }
VOID NTAPI PsReturnProcessPagedPoolQuota(PEPROCESS p, SIZE_T n) { (void)p; (void)n; }

/* image.c rejects headers above this; the whole linear memory of the module is "user" space. */
PVOID MmHighestUserAddress = (PVOID)0x7FFEFFFF;

/* ---- handle table ---- */
/* The kernel headers address the PCR at a fixed address (KIP0PCRADDRESS, patched to 0x400 for wasm; the module is
 * linked with --global-base=0x4000 so that range is free). One fake thread is "current"; APC state is never used. */
_Static_assert(sizeof(KPCR) < 0x3c00, "PCR must fit below the data segment");
static KTHREAD fake_thread;
static KPRCB fake_prcb;
EXPORT("nt_ex_init") void nt_ex_init(void) {
  KPCR *pcr = (KPCR *)KIP0PCRADDRESS;
  __builtin_memset(pcr, 0, sizeof *pcr);
  pcr->SelfPcr = pcr;
  pcr->Prcb = &fake_prcb;
  fake_prcb.CurrentThread = &fake_thread;
  ExpInitializeHandleTables();
}

EXPORT("nt_ht_create") PHANDLE_TABLE nt_ht_create(void) { return ExCreateHandleTable(NULL); }
EXPORT("nt_ht_destroy") void nt_ht_destroy(PHANDLE_TABLE t) { ExDestroyHandleTable(t, NULL); }

/* `obj` must have its low 3 bits clear (NT keeps lock/protect/inherit flags there). Returns 0 on exhaustion. */
EXPORT("nt_ht_create_handle") unsigned nt_ht_create_handle(PHANDLE_TABLE t, void *obj, unsigned access) {
  HANDLE_TABLE_ENTRY e;
  __builtin_memset(&e, 0, sizeof e);
  e.Object = obj;
  e.GrantedAccess = access;
  return (unsigned)(ULONG_PTR)ExCreateHandle(t, &e);
}
/* Looks a handle up; writes the access mask to *access. Returns the object or NULL for an invalid handle. */
EXPORT("nt_ht_lookup") void *nt_ht_lookup(PHANDLE_TABLE t, unsigned handle, unsigned *access) {
  PHANDLE_TABLE_ENTRY e = ExMapHandleToPointer(t, (HANDLE)(ULONG_PTR)handle);
  void *obj;
  if (!e) return NULL;
  obj = (void *)((ULONG_PTR)e->Object & ~(ULONG_PTR)7);
  if (access) *access = e->GrantedAccess;
  ExUnlockHandleTableEntry(t, e);
  return obj;
}
EXPORT("nt_ht_close") int nt_ht_close(PHANDLE_TABLE t, unsigned handle) {
  return ExDestroyHandle(t, (HANDLE)(ULONG_PTR)handle, NULL) ? 1 : 0;
}

/* ---- PE image helpers (ReactOS rtl/image.c) ---- */
NTSTATUS NTAPI RtlpImageNtHeaderEx(ULONG Flags, PVOID Base, ULONG64 Size, PIMAGE_NT_HEADERS *Out);
/* out: [0]=NT headers file offset, [1]=machine|characteristics<<16, [2]=sections, [3]=entry RVA, [4]=size of image,
 * [5]=subsystem|dllchar<<16, [6..7]=image base (u64), [8]=magic. Returns 0 or an NTSTATUS. */
EXPORT("nt_pe_inspect") int nt_pe_inspect(unsigned char *base, unsigned size, unsigned *out) {
  PIMAGE_NT_HEADERS nt = NULL;
  NTSTATUS st = RtlpImageNtHeaderEx(0, base, (ULONG64)size, &nt);
  const unsigned char *oh;
  unsigned magic;
  if (st != STATUS_SUCCESS || !nt) return st ? st : (int)STATUS_INVALID_IMAGE_FORMAT;
  oh = (const unsigned char *)&nt->OptionalHeader;
  magic = *(const unsigned short *)oh;
  out[0] = (unsigned)((unsigned char *)nt - base);
  out[1] = nt->FileHeader.Machine | ((unsigned)nt->FileHeader.Characteristics << 16);
  out[2] = nt->FileHeader.NumberOfSections;
  out[3] = *(const unsigned *)(oh + 16);
  out[4] = *(const unsigned *)(oh + 56);
  out[8] = magic;
  if (magic == 0x20b) { /* PE32+ */
    out[5] = *(const unsigned short *)(oh + 68) | ((unsigned)*(const unsigned short *)(oh + 70) << 16);
    out[6] = *(const unsigned *)(oh + 24);
    out[7] = *(const unsigned *)(oh + 28);
  } else {              /* PE32 */
    out[5] = *(const unsigned short *)(oh + 68) | ((unsigned)*(const unsigned short *)(oh + 70) << 16);
    out[6] = *(const unsigned *)(oh + 28);
    out[7] = 0;
  }
  return 0;
}
/* Maps an RVA to a file offset through the section table (RtlImageRvaToVa on an unmapped image); -1 if unmapped. */
EXPORT("nt_pe_rva_to_offset") int nt_pe_rva_to_offset(unsigned char *base, unsigned size, unsigned rva) {
  PIMAGE_NT_HEADERS nt = NULL;
  PIMAGE_SECTION_HEADER sec = NULL;
  PVOID va;
  if (RtlpImageNtHeaderEx(0, base, (ULONG64)size, &nt) != STATUS_SUCCESS || !nt) return -1;
  va = RtlImageRvaToVa(nt, base, rva, &sec);
  return (va && (unsigned char *)va >= base && (unsigned)((unsigned char *)va - base) < size) ? (int)((unsigned char *)va - base) : -1;
}
/* Number of 16 data directory slots are read by the caller from the optional header; this returns size/RVA. */
EXPORT("nt_pe_directory") int nt_pe_directory(unsigned char *base, unsigned size, unsigned index, unsigned *out) {
  PIMAGE_NT_HEADERS nt = NULL;
  const unsigned char *oh, *dd;
  unsigned magic, count;
  if (RtlpImageNtHeaderEx(0, base, (ULONG64)size, &nt) != STATUS_SUCCESS || !nt) return -1;
  oh = (const unsigned char *)&nt->OptionalHeader;
  magic = *(const unsigned short *)oh;
  dd = oh + (magic == 0x20b ? 112 : 96);
  count = *(const unsigned *)(dd - 4);
  if (index >= count || index >= 16) return -1;
  out[0] = *(const unsigned *)(dd + index * 8);
  out[1] = *(const unsigned *)(dd + index * 8 + 4);
  return 0;
}
