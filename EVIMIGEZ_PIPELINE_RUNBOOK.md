# evimigez 3DGS Pipeline Runbook

Bu not, render-engine ve nerfstudio tarafında şimdiye kadar yapılan adımları toplar. Amaç, uygulamayı host ederken aynı hatalı basamakları tekrar tekrar yürütmemek ve kaldığımız yerden hızlıca devam edebilmek.

## Hedef Akış

1. Video yükle.
2. FFmpeg ile frame çıkar.
3. `ns-process-data` ile COLMAP sparse reconstruction üret.
4. `ns-train splatfacto` ile Gaussian Splat eğit.
5. `ns-export` ile `.ply` üret.
6. `.ply` dosyasını viewer URL üzerinden servis et.

## Şu Ana Kadar Yapılanlar

### render-engine

- [render-engine/src/config.js](render-engine/src/config.js) içinde `.env` yükleme, `render-engine/` kökünden bağımsız hale getirildi.
- [render-engine/src/routes/upload.js](render-engine/src/routes/upload.js) içinde video frame çıkarma FPS değeri `2` yerine `5` yapıldı. Bu, daha fazla görüntü ile COLMAP/3DGS tarafına daha iyi veri gönderiyor.
- [render-engine/src/pipeline/splatProcessor.js](render-engine/src/pipeline/splatProcessor.js) içinde `colmap` pipeline aktif.
- Aynı dosyada alt süreçler için `PATH`, `INCLUDE` ve `LIB` genişletildi.

### nerfstudio / COLMAP uyarlamaları

- COLMAP 4.x ile uyum için nerfstudio içindeki feature extraction ve matching komutları güncellendi.
- `vocab_tree` bağımlılığı çıkarılıp varsayılan eşleştirme `exhaustive` yapıldı.
- Mapper tarafına `--Mapper.init_min_num_inliers=5` eklendi.
- `scripts.py` içindeki `stderr.decode(...)` çağrısı `None` kontrolü ile korundu.
- `pkg_resources` hatası için `setuptools` sürümü düşürüldü.

### Geliştirme ortamı

- COLMAP binary yolu:
  `C:\Users\ozgen\OneDrive\Masaüstü\playcanvas\colmap-x64-windows-cuda\bin\colmap.exe`
- nerfstudio conda env:
  `C:\Users\ozgen\miniconda3\envs\nerfstudio`
- nerfstudio scriptleri:
  `ns-process-data.exe`, `ns-train.exe`, `ns-export.exe`
- FFmpeg yolu child process PATH içine eklendi.

## Son Toolchain Durumu

### Yapılan kurulumlar

- `cuda-nvcc` kuruldu.
- `ninja` kuruldu.
- Visual Studio 2022 Build Tools kuruldu.
- Windows SDK 10.0.22621 kuruldu.
- `nvcc` 12.4 seviyesine yükseltildi.

### gsplat derleme sürecinde görülen hata zinciri

1. `Ninja is required to load C++ extensions`
   - `ninja` PATH'e eklenince bu aşama geçti.
2. `cuda_runtime.h: No such file or directory`
   - Windows SDK / CUDA headers eksikti.
   - `cuda-cudart-dev` ve Windows SDK ile düzeldi.
3. `unsupported Microsoft Visual Studio version`
   - `-allow-unsupported-compiler` bayrağı eklendi.
4. `corecrt.h: No such file or directory`
   - Windows SDK UCRT başlıkları eklendi.
5. `error STL1002: Unexpected compiler version, expected CUDA 12.4 or newer.`
   - `cuda-nvcc` 12.4'e yükseltildi ve STL mismatch override eklendi.
6. Son aşamada CUB/GLM tarafında `dispatch_segmented_sort.cuh` derleme hatasına ulaşıldı.
   - Bu nokta, önceki eksik araç zinciri sorunlarının aşıldığını gösteriyor.
   - Kalan konu artık gsplat + CUDA + MSVC + CUB uyumluluğu.

## Kaldığımız Yer

Şu anda render-engine tarafında süreç çevresi güncellendi ve gsplat derleme zinciri ileri bir noktaya kadar geldi. Kalan engel, gsplat/CUDA derleme uyumsuzluğu; özellikle `CUB`/`dispatch_segmented_sort.cuh` hattında patlıyor.

Bu yüzden bir sonraki oturumda sıfırdan kurulum adımlarını tekrar denemek yerine önce bu dosyaya bakıp mevcut durumu kontrol et.

## Bir Sonraki Oturum İçin Hızlı Kontrol Listesi

1. [render-engine/src/pipeline/splatProcessor.js](render-engine/src/pipeline/splatProcessor.js) içindeki child env ayarlarını değiştirildiği gibi bırak.
2. `where nvcc` ile 12.4 geldiğini doğrula.
3. `where cl` ve `where ninja` ile toolchain'i doğrula.
4. `python -c "from gsplat.cuda._backend import _C; print(type(_C).__name__)"` ile derleme dene.
5. Eğer aynı CUB/STL hatası sürerse, yeni kurulum adımı aramak yerine uyumlu CUDA / gsplat / torch kombinasyonunu değerlendirmeye geç.

## Notlar

- Untracked COLMAP zip / klasörleri repo tarihi için gerekli değilse commit etme.
- Bu runbook, host uygulama çalıştırılırken aynı engellere tekrar takılmamak için referans olarak tutulmalı.