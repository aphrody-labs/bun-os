/* ntcore: SEH is not available on wasm32; map to straight-line code (exceptions trap). */
#pragma once
#define _SEH2_TRY {
#define _SEH2_EXCEPT(x) } if (0) {
#define _SEH2_FINALLY } {
#define _SEH2_END }
#define _SEH2_GetExceptionInformation() ((void*)0)
#define _SEH2_GetExceptionCode() (0)
#define _SEH2_AbnormalTermination() (0)
#define _SEH2_YIELD(x) x
#define _SEH2_LEAVE
#define _SEH2_VOLATILE
#define _SEH2_EXCEPT_FILTER(x) x
#define _SEH2_DECLARE_EXCEPTION_FILTER(x)
