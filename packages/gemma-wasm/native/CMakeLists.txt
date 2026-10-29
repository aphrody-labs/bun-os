# SPDX-License-Identifier: Apache-2.0
# Gemma on llama.cpp/ggml for WebAssembly. Configure with emcmake; see ../scripts/build.sh.
#   GW_VARIANT = web   browser worker, pthreads + SIMD, JS API (default memory64)
#                node  Bun/Node, NODERAWFS, pthreads + SIMD
#                wasi  standalone WASI command for wasmtime / node:wasi (single thread)
cmake_minimum_required(VERSION 3.20)
project(gemma_wasm CXX C)

set(GW_VARIANT "web" CACHE STRING "web | node | wasi")
set(GW_LLAMA_DIR "" CACHE PATH "llama.cpp checkout at the pinned release")
set(GW_MEM64 ON CACHE BOOL "wasm64 (memory64) instead of wasm32 (4 GiB limit)")
if (NOT GW_LLAMA_DIR)
  message(FATAL_ERROR "set -DGW_LLAMA_DIR=<llama.cpp checkout>")
endif()

set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_HTML OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_WASM_MEM64 ${GW_MEM64} CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

set(COMMON_FLAGS -msimd128 -fwasm-exceptions)
if (GW_VARIANT STREQUAL "wasi")
  set(GW_MEM64 OFF)
  set(LLAMA_WASM_MEM64 OFF CACHE BOOL "" FORCE)
  set(GGML_CPU_REPACK OFF CACHE BOOL "" FORCE)
else()
  list(APPEND COMMON_FLAGS -pthread -matomics -mbulk-memory)
endif()
add_compile_options(${COMMON_FLAGS})
add_link_options(${COMMON_FLAGS})

add_subdirectory(${GW_LLAMA_DIR} llama.cpp EXCLUDE_FROM_ALL)

add_executable(gemma-${GW_VARIANT} gemma_wasm.cpp)
target_link_libraries(gemma-${GW_VARIANT} PRIVATE llama)
target_include_directories(gemma-${GW_VARIANT} PRIVATE ${GW_LLAMA_DIR}/include ${GW_LLAMA_DIR}/ggml/include)
set_target_properties(gemma-${GW_VARIANT} PROPERTIES SUFFIX ".js")

set(EXPORTS "_gw_load,_gw_generate,_gw_stats,_gw_tokenize_count,_gw_free,_main,_malloc,_free")
set(RUNTIME "ccall,cwrap,FS,addFunction,removeFunction,UTF8ToString,stringToUTF8,lengthBytesUTF8,WORKERFS")
set(LINK
  "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=512MB" "-sSTACK_SIZE=2MB" "-sALLOW_TABLE_GROWTH=1"
  "-sEXPORTED_FUNCTIONS=${EXPORTS}" "-sEXPORTED_RUNTIME_METHODS=${RUNTIME}" "-sFORCE_FILESYSTEM=1"
  "-sINVOKE_RUN=0" "-sEXIT_RUNTIME=0" "-O3")

if (GW_VARIANT STREQUAL "web")
  list(APPEND LINK "-sENVIRONMENT=web,worker" "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createGemma"
       "-sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency" "-lworkerfs.js" "-sPROXY_TO_PTHREAD=0")
  if (GW_MEM64)
    list(APPEND LINK "-sMEMORY64=1")
  else()
    list(APPEND LINK "-sMAXIMUM_MEMORY=4GB")
  endif()
elseif (GW_VARIANT STREQUAL "node")
  list(APPEND LINK "-sENVIRONMENT=node" "-sNODERAWFS=1" "-sMODULARIZE=1" "-sEXPORT_NAME=createGemma"
       "-sPTHREAD_POOL_SIZE=4")
  if (GW_MEM64)
    list(APPEND LINK "-sMEMORY64=1")
  else()
    list(APPEND LINK "-sMAXIMUM_MEMORY=4GB")
  endif()
else()
  list(APPEND LINK "-sSTANDALONE_WASM=1" "-sPURE_WASI=1" "-sMAXIMUM_MEMORY=4GB" "-sINVOKE_RUN=1")
  set_target_properties(gemma-wasi PROPERTIES SUFFIX ".wasm")
endif()
target_link_options(gemma-${GW_VARIANT} PRIVATE ${LINK})
