#pragma once
/* ntcore: x86 intrinsics are not available on wasm32. */
void __debugbreak(void);
void _ReadWriteBarrier(void);
void _mm_pause(void);
unsigned long long __rdtsc(void);
void __nop(void);
long _InterlockedIncrement(volatile long *);
long _InterlockedDecrement(volatile long *);
long _InterlockedExchange(volatile long *, long);
long _InterlockedExchangeAdd(volatile long *, long);
long _InterlockedCompareExchange(volatile long *, long, long);
