. /tests/lib.sh
check dotnet-version "10.0" dotnet --version
check dotnet-runtimes "Microsoft.NETCore.App 10.0" dotnet --list-runtimes
check pe-managed-detected "pe-managed" bunos detect /fixtures/hello-managed.dll
check dispatch-managed-pe "hello from dotnet 10" bunos run /fixtures/hello-managed.dll
finish
