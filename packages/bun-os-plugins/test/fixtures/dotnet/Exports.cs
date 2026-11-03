// SPDX-License-Identifier: MIT
using System.Runtime.InteropServices;

namespace BunDotnetFixture;

public static class Exports
{
    [UnmanagedCallersOnly]
    public static int Add(int a, int b) => a + b;

    [UnmanagedCallersOnly]
    public static int ProcessId() => System.Environment.ProcessId;

    public delegate int BinaryDelegate(int a, int b);

    public static int Multiply(int a, int b) => a * b;
}
