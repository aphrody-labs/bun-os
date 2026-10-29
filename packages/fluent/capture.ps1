# Launches the WinUI app, finds its window, captures it with PrintWindow (PW_RENDERFULLCONTENT) and checks controls via UI Automation.
param([string]$Exe, [string]$Png, [string]$Json)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); public struct R { public int L,T,Rt,B; } }
'@
$p = Start-Process $Exe -PassThru
try {
  $root = [Windows.Automation.AutomationElement]::RootElement
  $win = $null
  for ($i = 0; $i -lt 60 -and -not $win; $i++) {
    Start-Sleep -Milliseconds 500
    $win = $root.FindFirst('Children', (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)))
  }
  if (-not $win) { throw 'window not found' }
  Start-Sleep -Seconds 3
  $ids = 'AppTitleBar','MainNav','NavHome','NavApps','InfoBar','PageTitle','DialogButton'
  $found = [ordered]@{}
  foreach ($id in $ids) {
    $e = $win.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $id)))
    $found[$id] = if ($e) { $e.Current.ControlType.ProgrammaticName } else { $null }
  }
  # capture first (the dialog is a separate popup), then drive the app through UI Automation
  $h = [IntPtr]$win.Current.NativeWindowHandle
  $r = New-Object W+R; [void][W]::GetWindowRect($h, [ref]$r)
  $w = $r.Rt - $r.L; $ht = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  $ok = [W]::PrintWindow($h, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
  # downscale to a tiny PNG
  $tw = 480; $th = [int]($ht * $tw / $w)
  $small = New-Object System.Drawing.Bitmap $tw, $th
  $g2 = [System.Drawing.Graphics]::FromImage($small); $g2.InterpolationMode = 'HighQualityBicubic'; $g2.DrawImage($bmp, 0, 0, $tw, $th); $g2.Dispose()
  $small.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png)
  # invoke the button, find the dialog
  $btn = $win.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, 'DialogButton')))
  ($btn.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2
  $dlg = $null
  for ($i = 0; $i -lt 10 -and -not $dlg; $i++) {
    $both = New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)), (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, 'ContentDialog from WinUI 3')))
    $dlg = $root.FindFirst('Descendants', $both)
    if (-not $dlg) { Start-Sleep -Milliseconds 500 }
  }
  $found['ContentDialogText'] = if ($dlg) { 'found' } else { $null }
  [ordered]@{ pid = $p.Id; title = $win.Current.Name; printWindow = $ok; width = $w; height = $ht; controls = $found } | ConvertTo-Json -Depth 4 | Set-Content $Json
} finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
