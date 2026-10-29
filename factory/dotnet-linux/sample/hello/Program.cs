// SPDX-License-Identifier: MIT
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

// One JSON line, so that CI and tests can parse it. IsDynamicCodeSupported is false in a NativeAOT binary.
Console.WriteLine(
    "{\"framework\":\"" + RuntimeInformation.FrameworkDescription +
    "\",\"rid\":\"" + RuntimeInformation.RuntimeIdentifier +
    "\",\"os\":\"" + RuntimeInformation.OSDescription.Replace("\\", "\\\\").Replace("\"", "\\\"") +
    "\",\"arch\":\"" + RuntimeInformation.ProcessArchitecture +
    "\",\"aot\":" + (RuntimeFeature.IsDynamicCodeSupported ? "false" : "true") +
    ",\"args\":" + args.Length + "}");
