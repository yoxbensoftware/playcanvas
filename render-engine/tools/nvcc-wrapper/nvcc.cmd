@echo off
set "CCBIN=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\cl.exe"
set "MSVCINC=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\include"
set "SDKINC=C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0"
"C:\Users\ozgen\miniconda3\envs\nerfstudio\bin\nvcc.exe" -allow-unsupported-compiler -ccbin "%CCBIN%" -I"%MSVCINC%" -I"%SDKINC%\ucrt" -I"%SDKINC%\um" -I"%SDKINC%\shared" -I"%SDKINC%\winrt" -I"%SDKINC%\cppwinrt" %*
