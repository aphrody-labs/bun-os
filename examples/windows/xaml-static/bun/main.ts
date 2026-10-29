// Prints "<path>\t<root element>\t<element count>" for every XAML file listed (one path per line) in argv[2].
const scan = (text: string) => {
  let i = 0, count = 0, root = "";
  while ((i = text.indexOf("<", i)) >= 0) {
    if (text.startsWith("<!--", i)) { const e = text.indexOf("-->", i + 4); i = e < 0 ? text.length : e + 3; continue; }
    if (text.startsWith("<![CDATA[", i)) { const e = text.indexOf("]]>", i); i = e < 0 ? text.length : e + 3; continue; }
    if (text.startsWith("<?", i)) { const e = text.indexOf("?>", i); i = e < 0 ? text.length : e + 2; continue; }
    const c = text[i + 1] ?? "";
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < text.length && !/[\s\/>]/.test(text[j]!)) j++;
      if (!root) root = text.slice(i + 1, j);
      count++;
      i = j;
    } else i++;
  }
  return { root, count };
};
for (const path of (await Bun.file(Bun.argv[2]!).text()).split(/\r?\n/).filter(Boolean)) {
  const { root, count } = scan((await Bun.file(path).text()).replace(/^﻿/, ""));
  console.log(`${path}\t${root}\t${count}`);
}
