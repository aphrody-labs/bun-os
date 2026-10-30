import { expect, test } from "bun:test";
import { detectDialect, gnuToMsvc, msvcToGnu, translate } from "../src/flags.ts";

test("GNU compile flags map to MSVC", () => {
  const result = gnuToMsvc([
    "-c",
    "-O2",
    "-std=gnu++17",
    "-DFOO=1",
    "-I",
    "inc",
    "-Iinc2",
    "-fPIC",
    "-o",
    "a.obj",
    "a.cc",
  ]);
  expect(result.args).toEqual(["/c", "/O2", "/std:c++17", "/DFOO=1", "/Iinc", "/Iinc2", "/Fo" + "a.obj", "a.cc"]);
  expect(result.dropped).toEqual(["-fPIC"]);
});

test("-o names the executable when not compiling only", () => {
  expect(gnuToMsvc(["main.c", "-o", "app.exe", "-lws2_32", "-LC:/libs"]).args).toEqual([
    "main.c",
    "/Feapp.exe",
    "ws2_32.lib",
    "/LIBPATH:C:/libs",
  ]);
});

test("depfile flags are dropped with their argument and unknown flags are reported", () => {
  const result = gnuToMsvc(["-MD", "-MF", "x.d", "-c", "-funroll-loops", "-weird-flag", "a.c"]);
  expect(result.args).toEqual(["/c", "-weird-flag", "a.c"]);
  expect(result.dropped).toEqual(["-MD", "-MF", "x.d", "-funroll-loops"]);
  expect(result.unknown).toEqual(["-weird-flag"]);
});

test("optimisation and debug levels", () => {
  expect(gnuToMsvc(["-O0", "-g"]).args).toEqual(["/Od", "/Z7"]);
  expect(gnuToMsvc(["-Os", "-O3"]).args).toEqual(["/O1", "/O2"]);
  expect(gnuToMsvc(["-isystem", "sys", "-include", "pch.h", "-Werror"]).args).toEqual([
    "/external:Isys",
    "/FIpch.h",
    "/WX",
  ]);
});

test("MSVC flags map to GNU", () => {
  const result = msvcToGnu(["/nologo", "/c", "/O2", "/std:c++20", "/DX=2", "/Iinc", "/EHsc", "/MD", "/Foa.o", "a.cpp"]);
  expect(result.args).toEqual(["-c", "-O2", "-std=c++20", "-DX=2", "-Iinc", "-fexceptions", "-o", "a.o", "a.cpp"]);
  expect(result.dropped).toEqual(["/nologo", "/MD"]);
});

test("/link tail keeps libraries and search paths", () => {
  expect(msvcToGnu(["main.c", "/link", "/LIBPATH:libs", "ws2_32.lib", "/SUBSYSTEM:WINDOWS"]).args).toEqual([
    "main.c",
    "-Llibs",
    "-lws2_32",
  ]);
});

test("POSIX absolute paths are not mistaken for MSVC options", () => {
  expect(detectDialect("cc", ["-c", "/usr/include/x.h"])).toBe("gnu");
  expect(detectDialect("cc", ["/c", "a.c"])).toBe("msvc");
  expect(detectDialect("C:\\VS\\bin\\cl.exe", ["a.c"])).toBe("msvc");
  expect(msvcToGnu(["/usr/src/a.c", "/c"]).args).toEqual(["/usr/src/a.c", "-c"]);
});

test("translate is the identity within one dialect", () => {
  expect(translate(["-c", "a.c"], "gnu", "gnu").args).toEqual(["-c", "a.c"]);
});
