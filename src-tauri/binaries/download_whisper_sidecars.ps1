# PowerShell script to download static Whisper.cpp binaries (CPU & CUDA) and GGML model for SUBaka Desktop resources
$PSScriptRoot = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$resDir = Join-Path (Split-Path -Parent -Path $PSScriptRoot) "resources"
New-Item -ItemType Directory -Force -Path $resDir | Out-Null

$whisperExeTarget = Join-Path $resDir "whisper.exe"
$cudaExeTarget = Join-Path $resDir "whisper-cuda.exe"
$modelTarget = Join-Path $resDir "ggml-small.bin"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Helper function to extract archives using tar.exe or Expand-Archive
function Extract-ZipArchive($zipPath, $destinationDir) {
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    $tarExe = Get-Command "tar.exe" -ErrorAction SilentlyContinue
    if ($tarExe) {
        Write-Host "Extracting using tar.exe: $zipPath -> $destinationDir"
        & tar.exe -xf $zipPath -C $destinationDir
    } else {
        Write-Host "Extracting using Expand-Archive: $zipPath -> $destinationDir"
        Expand-Archive -Path $zipPath -DestinationPath $destinationDir -Force
    }
}

# 1. Download CUDA cuBLAS Whisper binary + DLLs for NVIDIA GPU acceleration
if (-not (Test-Path $cudaExeTarget) -or (Get-Item $cudaExeTarget).Length -lt 100000) {
    Write-Host "Downloading CUDA cuBLAS Whisper binary into resources..."
    $cudaZipTarget = Join-Path $resDir "whisper-cublas-x64.zip"
    $cudaZipUrls = @(
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-12.4.0-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-cublas-11.8.0-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-12.4.0-bin-x64.zip"
    )
    $tempCudaDir = Join-Path $resDir "temp_cuda_extract"

    foreach ($cudaUrl in $cudaZipUrls) {
        Write-Host "Attempting download of CUDA Whisper from $cudaUrl..."
        try {
            & curl.exe -s -S -f -L --retry 5 --retry-delay 2 -H "User-Agent: Mozilla/5.0" $cudaUrl -o $cudaZipTarget
        } catch {
            Write-Host "curl.exe error: $_"
        }
        if ((Test-Path $cudaZipTarget) -and (Get-Item $cudaZipTarget).Length -gt 1000000) {
            Write-Host "CUDA zip downloaded successfully ($((Get-Item $cudaZipTarget).Length) bytes)"
            break
        }
    }

    if ((Test-Path $cudaZipTarget) -and (Get-Item $cudaZipTarget).Length -gt 1000000) {
        try {
            Extract-ZipArchive $cudaZipTarget $tempCudaDir

            # Find executable recursively inside extracted structure
            $cliExe = Get-ChildItem -Path $tempCudaDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCudaDir -Recurse -Filter "main.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCudaDir -Recurse -Filter "whisper.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCudaDir -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }

            if ($cliExe) {
                Copy-Item $cliExe.FullName $cudaExeTarget -Force
                Write-Host "CUDA Whisper binary extracted: $cudaExeTarget ($((Get-Item $cudaExeTarget).Length) bytes)"
            } else {
                Write-Host "Warning: Could not locate executable in CUDA zip"
            }

            # Copy all DLLs (cublas64_*.dll, cudart64_*.dll, whisper.dll, ggml*.dll, etc.) to resources root
            $cudaDlls = Get-ChildItem -Path $tempCudaDir -Recurse -Filter "*.dll" -ErrorAction SilentlyContinue
            Write-Host "Found $($cudaDlls.Count) DLL(s) in CUDA archive."
            foreach ($dll in $cudaDlls) {
                Copy-Item $dll.FullName $resDir -Force
                Write-Host "Extracted CUDA DLL: $($dll.Name) ($($dll.Length) bytes)"
            }
        } catch {
            Write-Host "Notice: CUDA extraction error: $_"
        } finally {
            Remove-Item $tempCudaDir -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item $cudaZipTarget -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "Warning: Could not download CUDA Whisper package"
    }
}

# 2. Download standard Whisper CPU binary + CPU DLLs
if (-not (Test-Path $whisperExeTarget) -or (Get-Item $whisperExeTarget).Length -lt 100000) {
    Write-Host "Downloading standard whisper.exe binary into resources..."
    $zipTarget = Join-Path $resDir "whisper-bin-x64.zip"
    $whisperZipUrls = @(
        "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip",
        "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip"
    )
    $tempCpuDir = Join-Path $resDir "temp_cpu_extract"

    foreach ($cpuUrl in $whisperZipUrls) {
        Write-Host "Attempting download of CPU Whisper from $cpuUrl..."
        try {
            & curl.exe -s -S -f -L --retry 5 --retry-delay 2 -H "User-Agent: Mozilla/5.0" $cpuUrl -o $zipTarget
        } catch {
            Write-Host "curl.exe error: $_"
        }
        if ((Test-Path $zipTarget) -and (Get-Item $zipTarget).Length -gt 500000) {
            Write-Host "CPU zip downloaded successfully ($((Get-Item $zipTarget).Length) bytes)"
            break
        }
    }

    if ((Test-Path $zipTarget) -and (Get-Item $zipTarget).Length -gt 500000) {
        try {
            Extract-ZipArchive $zipTarget $tempCpuDir

            $cliExe = Get-ChildItem -Path $tempCpuDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCpuDir -Recurse -Filter "main.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCpuDir -Recurse -Filter "whisper.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }
            if (-not $cliExe) {
                $cliExe = Get-ChildItem -Path $tempCpuDir -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            }

            if ($cliExe) {
                Copy-Item $cliExe.FullName $whisperExeTarget -Force
                Write-Host "Standard Whisper CPU binary extracted: $whisperExeTarget ($((Get-Item $whisperExeTarget).Length) bytes)"
            } else {
                Write-Host "Warning: Could not locate executable in CPU zip"
            }

            # Copy all DLLs (whisper.dll, ggml*.dll, SDL2.dll) to resources root
            $cpuDlls = Get-ChildItem -Path $tempCpuDir -Recurse -Filter "*.dll" -ErrorAction SilentlyContinue
            Write-Host "Found $($cpuDlls.Count) DLL(s) in CPU archive."
            foreach ($dll in $cpuDlls) {
                Copy-Item $dll.FullName $resDir -Force
                Write-Host "Extracted CPU DLL: $($dll.Name) ($($dll.Length) bytes)"
            }
        } catch {
            Write-Host "Warning: Failed extracting whisper CPU zip: $_"
        } finally {
            Remove-Item $tempCpuDir -Recurse -Force -ErrorAction SilentlyContinue
            Remove-Item $zipTarget -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "Warning: Failed downloading whisper CPU zip"
    }
}

# 3. Download ggml-small.bin model if missing or invalid (< 10 MB)
if (-not (Test-Path $modelTarget) -or (Get-Item $modelTarget).Length -lt 10000000) {
    Write-Host "Downloading ggml-small.bin model (~460MB) into resources..."
    $modelUrls = @(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "https://huggingface.co/datasets/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
    )
    foreach ($mUrl in $modelUrls) {
        Write-Host "Attempting download of model from $mUrl..."
        try {
            & curl.exe -s -S -f -L --retry 5 --retry-delay 3 -H "User-Agent: Mozilla/5.0" $mUrl -o $modelTarget
        } catch {
            Write-Host "Warning: Failed downloading ggml-small.bin from ${mUrl} - $_"
        }
        if ((Test-Path $modelTarget) -and (Get-Item $modelTarget).Length -gt 10000000) {
            break
        }
    }
}

Write-Host "=== WHISPER & DLL RESOURCES SUMMARY ==="
if (Test-Path $whisperExeTarget) {
    Write-Host "✓ Whisper CPU executable ready: $whisperExeTarget ($((Get-Item $whisperExeTarget).Length) bytes)"
} else {
    Write-Host "✗ whisper.exe not present in resources!"
}

if (Test-Path $cudaExeTarget) {
    Write-Host "✓ Whisper CUDA executable ready: $cudaExeTarget ($((Get-Item $cudaExeTarget).Length) bytes)"
} else {
    Write-Host "✗ whisper-cuda.exe not present in resources!"
}

$allDlls = Get-ChildItem -Path $resDir -Filter "*.dll" -ErrorAction SilentlyContinue
Write-Host "✓ Total DLLs in resources: $($allDlls.Count)"
foreach ($d in $allDlls) {
    Write-Host "   - $($d.Name) ($($d.Length) bytes)"
}

if (Test-Path $modelTarget) {
    Write-Host "✓ Whisper GGML model ready: $modelTarget ($([math]::Round((Get-Item $modelTarget).Length / 1MB, 2)) MB)"
} else {
    Write-Host "Notice: ggml-small.bin not present in resources."
}

if (-not (Test-Path $whisperExeTarget) -or $allDlls.Count -eq 0) {
    Write-Error "CRITICAL: Essential Whisper binaries or DLLs are missing from $resDir"
    exit 1
}
