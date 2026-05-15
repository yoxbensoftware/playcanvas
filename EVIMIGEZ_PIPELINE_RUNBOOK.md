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

## 2026-05-15 Devam Notu (Reset Sonrası)

- WSL Ubuntu tekrar doğrulandı ve root ile komut çalıştırma test edildi (`WSL_OK`).
- Ubuntu default kullanıcı `root` idi; `ozgen` kullanıcısı oluşturulup `/etc/wsl.conf` ile default user `ozgen` yapıldı.
- `wsl --shutdown` sonrası doğrulama: `wsl -d Ubuntu -- whoami` çıktısı `ozgen`.
- `render-engine` servisi ayağa kaldırıldı:
   - Komut: `npm --prefix c:\\Users\\ozgen\\OneDrive\\Masaüstü\\playcanvas\\render-engine start`
   - Health: `http://localhost:3001/health` => `{"status":"ok","service":"render-engine","processor":"colmap"}`

### Güncel Teknik Bloker

- `gsplat` backend import denemesinde `cl` bulunamama sorunu aşıldı (MSVC path enjekte edilerek).
- Yeni ve asıl hata:
   - `nvcc fatal : Host compiler targets unsupported OS.`
- Ortamdaki MSVC:
   - `C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.51.36231\...`
- Sonuç: Windows tarafında mevcut CUDA + MSVC kombinasyonu `gsplat` JIT derlemesiyle uyumsuz.

### Buradan Sonraki En Güvenli Yol

1. Nerfstudio/gsplat eğitimini Ubuntu (WSL) tarafına taşı.
2. Windows `render-engine` sadece API/orchestrator olarak çalışmaya devam etsin.
3. WSL içinde CUDA erişimini doğrula (`nvidia-smi`) ve eğitim komutlarını Linux tarafında çalıştır.

## 2026-05-15 Ek Hata Analizi (ns-train exit code: 1)

- Job: `af34afb2-64c1-4fc3-a4c3-9180691386d1`
- COLMAP tamamlandı ama eşleşen görüntü oranı çok düşük çıktı:
  - `Colmap matched 3 images`
  - `COLMAP only found poses for 3.85% of the images`
- `ns-train` ilk iterasyonda `gsplat_cuda` JIT derlemesinde düştü.

### Doğrulanan nedenler

1. `build.ninja:3 lexing error`
   - Neden: PATH'te birden fazla `nvcc` görülmesi ile Ninja dosyası bozuluyordu.
   - Aksiyon: `render-engine/src/pipeline/splatProcessor.js` içinde `NVCC` tek path'e sabitlendi.

2. Sonraki blokaj: `nvcc fatal: Host compiler targets unsupported OS`
   - Neden: `nvcc` yanlış host compiler (MSVC 19.51 / VS18) seçiyordu.
   - Aksiyon: `render-engine/tools/nvcc-wrapper/nvcc.cmd` içinde `-ccbin` ile MSVC 14.44'e zorlama eklendi.

3. Sonraki blokaj: `fatal error C1083: 'crtdefs.h'`
   - Neden: Windows tarafında CUDA/MSVC/UCRT include zinciri hâlâ kararsız.
   - Bu nokta Windows'ta `gsplat` JIT derlemesinin kırılgan olduğunu tekrar doğruluyor.

### Pratik karar

- API/orchestrator (`render-engine`) Windows'ta çalışıyor.
- Eğitim adımı (`ns-train splatfacto`) için en güvenli yol WSL/Ubuntu tarafına geçmek.

Bu yüzden bir sonraki oturumda sıfırdan kurulum adımlarını tekrar denemek yerine önce bu dosyaya bakıp mevcut durumu kontrol et.

## 2026-05-16 Ek Devam Notu (Windows gsplat derin tanılama)

- `render-engine/src/pipeline/splatProcessor.js` içinde Windows eğitim ortamı tekrar sadeleştirildi:
   - `CUDAHOSTCXX` kaldırıldı (bazı denemelerde `'cl.exe' is not recognized` davranışını tetikliyordu).
   - PATH tarafında `nerfstudio\bin` doğrudan geri eklendi.
   - Eğitimden hemen önce CUB dosyasında `small` makro çakışması için otomatik patch adımı eklendi.

- Python/nerfstudio ortamı drift ettiği için yeniden hizalandı:
   - `torch==2.1.2+cu118`
   - `torchvision==0.16.2+cu118`
   - `numpy==1.26.4`
   - `gsplat==1.4.0` (nerfstudio 1.1.5 beklentisi)
   - `setuptools==69.5.1` (`distutils._msvccompiler` hatasını önlemek için)

- Sonuç: Windows tarafında CUDA JIT derleme kararlılığı düşüktür (IntersectTile.cu hatasında takıldı).
   - **Çözüm: WSL/Linux fallback'ine geçildi.**

## 2026-05-16 WSL Fallback Kurulumu (Final Çözüm)

✅ **Tamamlandı:**

1. **WSL nerfstudio training script**: 
   - `render-engine/tools/wsl-nerfstudio-train.sh` oluşturuldu
   - Script otomatik olarak Ubuntu'da venv kurup nerfstudio yükler
   - ns-process-data → ns-train → ns-export → PLY üretimi akışı kapsar

2. **Pipeline modernizasyonu**:
   - `render-engine/src/pipeline/splatProcessor.js` WSL tarafına delegasyon yapacak şekilde yeniden yazıldı
   - Windows render-engine API orchestrator olarak kaldı
   - Tüm eğitim Linux (WSL) tarafında çalışır

3. **Sistem doğrulaması**:
   - ✅ `render-engine`: http://localhost:3001/health → `{"status":"ok","processor":"colmap"}`
   - ✅ WSL Ubuntu 26.04 LTS
   - ✅ GPU erişim: `nvidia-smi` → NVIDIA GeForce RTX 4070 Laptop GPU
   - ✅ Python 3.14.4 hazır

4. **İş akışı özeti**:
   - Kullanıcı video yükler → render-engine FFmpeg frame çıkarır
   - render-engine `wsl-nerfstudio-train.sh` çalıştırır
   - WSL otomatik ortam kurup eğitim başlatır
   - Eğitim tamamında .ply döner → filesystem'a yüklenir
   - Viewer URL oluşturulur

**Not**: Nerfstudio WSL'ye ilk kurulumda ~30-45 dakika alır. Sonraki eğitimler sadece model eğitimine zaman harcar (~10-20 dakika, GPU'ya göre değişir).

## 2026-05-16 Son Doğrulama (Uçtan Uca Başarılı)

✅ **Canlı test başarılı (status=done):**

- Job ID: `87fae1f2-92ef-4dbc-a26e-fd3870574a35`
- Sonuç processor: `colmap-windows-fallback`
- Viewer URL: `http://localhost:3002/view/dd8b216d20`
- Download URL: `http://localhost:3002/api/files/dcd1cca8-32ee-4fa7-923f-741f596bda39/raw`

### Bu başarıyı sağlayan güncel değişiklikler

1. `render-engine/tools/wsl-nerfstudio-train.sh`
   - `python3 -m venv` başarısız olduğunda root gerektirmeyen `micromamba` fallback eklendi.
   - `micromamba` indirme yöntemi bzip2 bağımlılığı olmadan doğrudan binary (`micromamba-linux-64`) ile güncellendi.

2. `render-engine/src/pipeline/splatProcessor.js`
   - Windows fallback artık `cl.exe` varsa `splatfacto`, yoksa otomatik `nerfacto` kullanıyor.
   - `nerfacto` yolunda export `ns-export pointcloud` ile yapılıyor.
   - Pointcloud export için `--normal-method open3d` eklendi (normals output eksikliğinden erken çıkışı önlemek için).

### Mevcut pratik durum

- MSVC `cl.exe` yoksa pipeline artık `splatfacto` derlemesine kilitlenmiyor.
- Akış tamamlanıyor ve `.ply` dosyası filesystem servisine yüklenip viewer URL üretiliyor.
- Çıktı türü bu fallback yolunda `point_cloud.ply` (gaussian-splat export değil).

## Bir Sonraki Oturum İçin Hızlı Kontrol Listesi

1. [render-engine/src/pipeline/splatProcessor.js](render-engine/src/pipeline/splatProcessor.js) içindeki child env ayarlarını değiştirildiği gibi bırak.
2. `where nvcc` ile 12.4 geldiğini doğrula.
3. `where cl` ve `where ninja` ile toolchain'i doğrula.
4. `python -c "from gsplat.cuda._backend import _C; print(type(_C).__name__)"` ile derleme dene.
5. Eğer aynı CUB/STL hatası sürerse, yeni kurulum adımı aramak yerine uyumlu CUDA / gsplat / torch kombinasyonunu değerlendirmeye geç.

## Notlar

- Untracked COLMAP zip / klasörleri repo tarihi için gerekli değilse commit etme.
- Bu runbook, host uygulama çalıştırılırken aynı engellere tekrar takılmamak için referans olarak tutulmalı.