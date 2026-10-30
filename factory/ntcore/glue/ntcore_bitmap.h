/* RTL_BITMAP primitives for cmlib (same contract as sdk/lib/rtl/bitmap.c, linear scan). */
VOID NTAPI RtlInitializeBitMap(PRTL_BITMAP b, PULONG buf, ULONG n) { b->SizeOfBitMap = n; b->Buffer = buf; }
VOID NTAPI RtlSetAllBits(PRTL_BITMAP b) { __builtin_memset(b->Buffer, 0xFF, ((b->SizeOfBitMap + 31) / 32) * 4); }
VOID NTAPI RtlClearAllBits(PRTL_BITMAP b) { __builtin_memset(b->Buffer, 0, ((b->SizeOfBitMap + 31) / 32) * 4); }
VOID NTAPI RtlSetBits(PRTL_BITMAP b, ULONG start, ULONG n) {
  ULONG i;
  for (i = start; i < start + n; i++) b->Buffer[i / 32] |= 1u << (i % 32);
}
ULONG NTAPI RtlFindSetBits(PRTL_BITMAP b, ULONG n, ULONG hint) {
  ULONG i, run, from = hint < b->SizeOfBitMap ? hint : 0, pass;
  for (pass = 0; pass < 2; pass++) {
    ULONG lo = pass ? 0 : from, hi = pass ? from + n : b->SizeOfBitMap;
    if (hi > b->SizeOfBitMap) hi = b->SizeOfBitMap;
    for (run = 0, i = lo; i < hi; i++) {
      if ((b->Buffer[i / 32] >> (i % 32)) & 1) {
        if (++run == n) return i - n + 1;
      } else run = 0;
    }
  }
  return 0xFFFFFFFFu;
}
