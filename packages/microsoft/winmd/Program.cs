// SPDX-License-Identifier: MIT
// usage: WinmdDump <Windows.winmd> <Namespace> [<Namespace>...]
using System.Collections.Immutable;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

var path = args[0];
var wanted = args.Skip(1).ToHashSet();
using var stream = File.OpenRead(path);
using var pe = new PEReader(stream);
var md = pe.GetMetadataReader();
var provider = new TypeNames(md);
var types = new List<object>();

foreach (var h in md.TypeDefinitions)
{
    var t = md.GetTypeDefinition(h);
    var ns = md.GetString(t.Namespace);
    if (!wanted.Contains(ns)) continue;
    var attrs = t.Attributes;
    var baseName = t.BaseType.IsNil ? "" : provider.Handle(t.BaseType);
    var kind = (attrs & TypeAttributes.Interface) != 0 ? "interface" : baseName == "System.Enum" ? "enum" : baseName == "System.ValueType" ? "struct" : baseName == "System.MulticastDelegate" ? "delegate" : "class";
    var methods = new List<object>();
    var fields = new List<object>();
    foreach (var mh in t.GetMethods())
    {
        var m = md.GetMethodDefinition(mh);
        var name = md.GetString(m.Name);
        if (name.StartsWith(".") ) continue;
        var sig = m.DecodeSignature(provider, null);
        var ps = m.GetParameters().Select(p => md.GetParameter(p)).Where(p => p.SequenceNumber > 0).OrderBy(p => p.SequenceNumber).Select(p => md.GetString(p.Name)).ToList();
        methods.Add(new { name, returns = sig.ReturnType, parameters = sig.ParameterTypes.Select((ty, i) => new { name = i < ps.Count ? ps[i] : $"arg{i}", type = ty }) });
    }
    foreach (var fh in t.GetFields())
    {
        var f = md.GetFieldDefinition(fh);
        var fname = md.GetString(f.Name);
        if (fname == "value__") continue;
        object? value = null;
        var ch = f.GetDefaultValue();
        if (!ch.IsNil) { var c = md.GetConstant(ch); var br = md.GetBlobReader(c.Value); value = br.ReadConstant(c.TypeCode); }
        fields.Add(new { name = fname, type = f.DecodeSignature(provider, null), value });
    }
    types.Add(new { ns, name = md.GetString(t.Name), kind, @base = baseName, methods, fields });
}
Console.WriteLine(JsonSerializer.Serialize(new { winmd = Path.GetFileName(path), types }));

sealed class TypeNames : ISignatureTypeProvider<string, object?>
{
    private readonly MetadataReader md;
    public TypeNames(MetadataReader md) { this.md = md; }
    public string Handle(EntityHandle h) => h.Kind switch
    {
        HandleKind.TypeDefinition => Full(md.GetTypeDefinition((TypeDefinitionHandle)h).Namespace, md.GetTypeDefinition((TypeDefinitionHandle)h).Name),
        HandleKind.TypeReference => Full(md.GetTypeReference((TypeReferenceHandle)h).Namespace, md.GetTypeReference((TypeReferenceHandle)h).Name),
        _ => "unknown",
    };
    private string Full(StringHandle ns, StringHandle name) => md.GetString(ns) is { Length: > 0 } n ? n + "." + md.GetString(name) : md.GetString(name);
    public string GetPrimitiveType(PrimitiveTypeCode c) => c.ToString();
    public string GetTypeFromDefinition(MetadataReader r, TypeDefinitionHandle h, byte k) => Handle(h);
    public string GetTypeFromReference(MetadataReader r, TypeReferenceHandle h, byte k) => Handle(h);
    public string GetTypeFromSpecification(MetadataReader r, object? g, TypeSpecificationHandle h, byte k) => r.GetTypeSpecification(h).DecodeSignature(this, g);
    public string GetSZArrayType(string e) => e + "[]";
    public string GetArrayType(string e, ArrayShape s) => e + "[]";
    public string GetByReferenceType(string e) => e;
    public string GetPointerType(string e) => e + "*";
    public string GetGenericInstantiation(string g, ImmutableArray<string> a) => g + "<" + string.Join(",", a) + ">";
    public string GetGenericMethodParameter(object? c, int i) => "!!" + i;
    public string GetGenericTypeParameter(object? c, int i) => "!" + i;
    public string GetFunctionPointerType(MethodSignature<string> s) => "fnptr";
    public string GetModifiedType(string m, string u, bool r) => u;
    public string GetPinnedType(string e) => e;
}
