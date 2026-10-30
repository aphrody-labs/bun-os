// Prints "<path>\t<root element>\t<element count>" for every XAML file listed (one path per line) in args[0].
// XmlReader also proves each page is well-formed XML.
using System.Xml;

foreach (var path in File.ReadLines(args[0]).Where(l => l.Length > 0))
{
    using var reader = XmlReader.Create(path, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit });
    string root = ""; int count = 0;
    while (reader.Read())
        if (reader.NodeType == XmlNodeType.Element) { if (count == 0) root = reader.Name; count++; }
    Console.Out.Write($"{path}\t{root}\t{count}\n");
}
