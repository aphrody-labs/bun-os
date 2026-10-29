// Minimal task pane: reports the Office host and inserts text with the host-specific API (Word, Excel) when running inside Office.
// Outside Office (a plain browser) Office.onReady resolves with host === null and the pane says so.
Office.onReady(info => {
  const host = document.getElementById("host");
  const button = document.getElementById("insert");
  host.textContent = info.host ? `host: ${info.host}, platform: ${info.platform}` : "not running inside Office";
  if (!info.host) return;
  button.disabled = false;
  button.onclick = async () => {
    if (info.host === Office.HostType.Word)
      await Word.run(async c => (c.document.body.insertParagraph("Hello from Bun OS", "End"), c.sync()));
    else if (info.host === Office.HostType.Excel)
      await Excel.run(
        async c => (
          (c.workbook.worksheets.getActiveWorksheet().getRange("A1").values = [["Hello from Bun OS"]]),
          c.sync()
        ),
      );
  };
});
