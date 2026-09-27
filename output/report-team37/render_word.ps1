$ErrorActionPreference = 'Stop'
$reportRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputDoc = Join-Path $reportRoot 'Team37_AirDnD_IEEE_Report.docx'
$outputPdf = Join-Path $reportRoot 'preview/word-render.pdf'
$wordApp = $null
$reportDoc = $null
try {
    $wordApp = New-Object -ComObject Word.Application
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $wordApp.AutomationSecurity = 3
    $reportDoc = $wordApp.Documents.Open($inputDoc, $false, $true, $false)
    $reportDoc.Repaginate()
    Write-Output ('Word pages: ' + $reportDoc.ComputeStatistics(2))
} finally {
    if ($null -ne $reportDoc) {
        $reportDoc.Close(0)
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($reportDoc) | Out-Null
    }
    if ($null -ne $wordApp) {
        $wordApp.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wordApp) | Out-Null
    }
}
