# Flat gray photo glyph, same palette as the Grimcut clapper and Grimpad scroll.
# Writes src-tauri/icons/app-icon-source.png; then run `npx tauri icon src-tauri/icons/app-icon-source.png`.
Add-Type -AssemblyName System.Drawing

$s = 1024
$bmp = New-Object System.Drawing.Bitmap $s, $s
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

function New-Round([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  [void]$p.AddArc($x, $y, $d, $d, 180, 90)
  [void]$p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  [void]$p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  [void]$p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$paper = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 230, 230, 230))
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 118, 118, 118))
$mid = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 168, 168, 168))

# Photo card
$card = New-Round 120 200 784 624 72
$g.FillPath($paper, $card)
$g.SetClip($card)

# Sun
$g.FillEllipse($mid, 620, 300, 150, 150)

# Back hill
$back = @(
  (New-Object System.Drawing.PointF 380, 824),
  (New-Object System.Drawing.PointF 640, 470),
  (New-Object System.Drawing.PointF 960, 824)
)
$g.FillPolygon($mid, $back)

# Front mountain
$front = @(
  (New-Object System.Drawing.PointF 60, 824),
  (New-Object System.Drawing.PointF 380, 400),
  (New-Object System.Drawing.PointF 720, 824)
)
$g.FillPolygon($ink, $front)
$g.ResetClip()

$out = Join-Path $PSScriptRoot "..\src-tauri\icons\app-icon-source.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Wrote $out"
