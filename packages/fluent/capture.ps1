# Launches the WinUI app, finds its window, captures it with PrintWindow (PW_RENDERFULLCONTENT) and checks controls via UI Automation.
# No fixed sleeps: every wait polls a condition with a bounded deadline.
param([string]$Exe, [string]$Png, [string]$Json, [int]$TimeoutSec = 60)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); public struct R { public int L,T,Rt,B; } }
'@
$AE = [Windows.Automation.AutomationElement]
function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$What) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $v = & $Condition
        if ($v) { return $v }
        Start-Sleep -Milliseconds 100
    }
    throw "timed out after ${Seconds}s waiting for $What"
}
function Find-ById($scope, [string]$id) {
    $scope.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $id)))
}
$p = Start-Process $Exe -PassThru
try {
    $root = $AE::RootElement
    $win = Wait-Until { $root.FindFirst('Children', (New-Object Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id))) } $TimeoutSec 'the app window'
    $ids = 'AppTitleBar', 'MainNav', 'NavHome', 'NavApps', 'InfoBar', 'PageTitle', 'DialogButton'
    $found = [ordered]@{}
    # all controls must be in the UIA tree before anything is captured or invoked
    [void](Wait-Until { ($ids | Where-Object { -not (Find-ById $win $_) }).Count -eq 0 } $TimeoutSec 'all controls in the UIA tree')
    foreach ($id in $ids) { $found[$id] = (Find-ById $win $id).Current.ControlType.ProgrammaticName }

    # capture first (the dialog is a separate popup); retry until the frame is not a uniform (unrendered) bitmap
    $h = [IntPtr]$win.Current.NativeWindowHandle
    $snap = {
        $r = New-Object W+R; [void][W]::GetWindowRect($h, [ref]$r)
        $w = $r.Rt - $r.L; $ht = $r.B - $r.T
        if ($w -lt 100 -or $ht -lt 100) { return $null }
        $bmp = New-Object System.Drawing.Bitmap $w, $ht
        $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
        $ok = [W]::PrintWindow($h, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
        $colors = @{}
        foreach ($x in 1..9) { foreach ($y in 1..9) { $colors[$bmp.GetPixel([int]($w * $x / 10), [int]($ht * $y / 10)).ToArgb()] = 1 } }
        if ($ok -and $colors.Count -gt 2) { [pscustomobject]@{ Bmp = $bmp; W = $w; H = $ht; Ok = $ok } } else { $bmp.Dispose(); $null }
    }
    $shot = Wait-Until $snap $TimeoutSec 'a rendered frame'
    $tw = 480; $th = [int]($shot.H * $tw / $shot.W)
    $small = New-Object System.Drawing.Bitmap $tw, $th
    $g2 = [System.Drawing.Graphics]::FromImage($small); $g2.InterpolationMode = 'HighQualityBicubic'; $g2.DrawImage($shot.Bmp, 0, 0, $tw, $th); $g2.Dispose()
    $small.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png)

    # drive the app through UI Automation: invoke the button, wait for the dialog text
    $btn = Find-ById $win 'DialogButton'
    ($btn.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)).Invoke()
    $dialogCond = New-Object Windows.Automation.AndCondition(
        (New-Object Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)),
        (New-Object Windows.Automation.PropertyCondition($AE::NameProperty, 'ContentDialog from WinUI 3')))
    $dlg = Wait-Until { $root.FindFirst('Descendants', $dialogCond) } 20 'the ContentDialog text'
    $found['ContentDialogText'] = if ($dlg) { 'found' } else { $null }
    [ordered]@{ pid = $p.Id; title = $win.Current.Name; printWindow = $shot.Ok; width = $shot.W; height = $shot.H; controls = $found } |
        ConvertTo-Json -Depth 4 | Set-Content $Json
} finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
