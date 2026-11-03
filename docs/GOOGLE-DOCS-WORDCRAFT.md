# Google Docs and WordCraft

The Google package can prepare a local document for the existing WordCraft
editor without synchronizing or changing its Google source:

```sh
yolo google docs snapshot GOOGLE_DOCUMENT_ID path/to/docs-api-snapshot.json
yolo google docs project path/to/docs-api-snapshot.json path/to/new-document.md
yolo google docs export GOOGLE_DOCUMENT_ID path/to/new-document.docx
yolo google docs open path/to/new-document.docx
```

`snapshot` explicitly uses the authenticated Docs API to save the selected
document, including its tabs, as a local JSON file. Its serialized output is
limited to 32 MiB; the API client buffers the response before this limit is
checked. It needs network access and authorization.

`project` is offline: it uses an already saved Google Docs API document snapshot
and the existing Docs-to-Markdown projection. It handles its supported text,
formatting, lists, tables, links, tabs and footnotes; conversion is not lossless
and unsupported elements may fail. The source snapshot stays intact. WordCraft
can open Markdown and save another format locally.

`export` explicitly calls Google Drive's export API to make a DOCX, using the
account already configured for `@aphrody/google`. It needs network access and
authorization, and Google may alter features during conversion. All three commands
create a new file and refuse to overwrite an existing path. The DOCX export is
streamed with a 32 MiB limit and partial output is removed on failure.
It also checks the ZIP signature WordCraft expects; this does not prove that
the archive contains a valid or fully supported DOCX document.

The `@aphrody/google/docs-wordcraft` subpath exposes snapshot, projection and
export to Bun callers. The `open` command starts `wordcraft` from PATH with the local file as
an argument; `--binary /path/to/wordcraft` selects a specific build. A successful
start does not prove that the editor loaded the file; report errors in WordCraft.
This bridge does not provide a local implementation of Google Docs,
collaboration, Google Drive synchronization, or format fidelity guarantees.
