# Thermal Printer

Kembali ke indeks dokumentasi: `docs/README.md`

## Tujuan

Cetak receipt ke printer thermal dengan ESC/POS sebagai format utama, tanpa mengikat aplikasi ke merek printer tertentu. Receipt dibuat terpisah dari transport printer; LAN printer ditangani server-side oleh Laravel, sementara USB/Bluetooth BLE/System tetap ditangani sesuai kemampuan browser.

## Fitur Saat Ini

### ThermalPrintService (Server-side)
- Generate teks receipt dalam format monospace
- Support 80mm (48 karakter) dan 58mm (32 karakter)
- Format: header toko, invoice info, item list, subtotal, diskon, PPN, total, pembayaran, footer
- Output: plain text (`generateReceiptText`) dan HTML (`generateReceiptHtml`)

### Thermal Print Route
- `GET /dashboard/documents/transactions/{invoice}/print/thermal` — HTML receipt
- Dipakai sebagai fallback browser-print jika printer ESC/POS tidak tersedia atau gagal
- `POST /dashboard/settings/printer/{printer}/test` — test print LAN berdasarkan printer ID yang tersimpan
- `POST /dashboard/transactions/{invoice}/print/thermal` — print receipt LAN berdasarkan invoice + printer ID

### Printer Settings
- Tambah, edit, hapus, dan pilih default printer
- Tipe printer: USB/WebUSB, LAN/Ethernet via Laravel TCP socket, Bluetooth BLE/GATT, dan system printer
- Paper size per printer: 80mm / 58mm
- Auto-print toggle memakai printer default jika koneksi mendukung tanpa dialog browser

## PrinterManager (Client-side)

`resources/js/Utils/escpos.js` menyediakan generator byte ESC/POS untuk browser-capable transport dan adapter pemilihan printer:

- `buildReceiptBytes(data, paperSize)` — ESC/POS 58mm/80mm, auto cut `GS V`
- `UsbPrinter` — WebUSB, memilih perangkat tanpa filter vendor tertentu dan mencari endpoint output printer class 7 bila tersedia
- `LanPrinter` — browser hanya mengirim `printer_id` dan invoice ke Laravel; Laravel membuka TCP ke printer
- `BluetoothPrinter` — Web Bluetooth hanya untuk perangkat BLE/GATT yang punya service UUID + characteristic UUID
- `SystemPrinter` — fallback ke dialog print OS/browser
- `PrinterManager` — memilih adapter berdasarkan konfigurasi printer default

> **Catatan browser:** WebUSB hanya tersedia di browser Chromium dan printer harus kompatibel. Browser tidak melakukan raw TCP langsung ke printer LAN; browser hanya berkomunikasi dengan Laravel melalui HTTP/HTTPS. Web Bluetooth tidak sama dengan Bluetooth Classic/SPP, jadi hanya printer BLE/GATT yang kompatibel yang bisa dipakai dari browser. System printer selalu tersedia sebagai fallback melalui dialog print.

## LAN Printing via Laravel

Alur:

```
Browser -> Laravel endpoint -> ThermalPrinterService -> TCP socket -> printer ESC/POS
```

Konfigurasi LAN berasal dari `settings.printer`, bukan dari request bebas browser:

```http
POST /dashboard/settings/printer/{printer}/test
Content-Type: application/json
```

```http
POST /dashboard/transactions/{invoice}/print/thermal
Content-Type: application/json

{ "printer_id": "kasir-1" }
```

Laravel akan mengambil host/port/timeout dari printer profile yang sudah tersimpan, lalu membuka socket TCP ke printer. Error JSON dibedakan untuk invalid configuration, timeout, connection refused, host unreachable, DNS gagal, dan printer tidak ditemukan.

## Contoh Konfigurasi LAN

- **Name:** Kasir 1
- **Type:** LAN / Ethernet
- **Host:** `192.168.1.50`
- **Port:** `9100`
- **Paper size:** `80mm`
- **Timeout:** `5000`
- **Status:** Aktif

Untuk menentukan IP printer, gunakan halaman konfigurasi printer, DHCP lease router, atau cetak self-test printer. Port ESC/POS umum adalah `9100`, tetapi beberapa printer bisa memakai port lain sesuai manual perangkat.

## Route

| Route | Method | Fungsi |
|-------|--------|--------|
| `pdf.transactions.thermal` | GET | HTML receipt thermal |
| `settings.printer` | GET | Halaman settings printer |
| `settings.printer.update` | POST | Simpan settings printer |
| `settings.printer.test` | POST | Test print LAN berdasarkan printer ID |
| `transactions.print.thermal` | POST | Print receipt LAN berdasarkan invoice + printer ID |

## Format Receipt (80mm)

```
            TOKO ANDA
        Jl. Contoh No. 123
        Telp: 021-123456
--------------------------------
No: TRX-XXXXXXXXXX
Tgl: 22/06/2026 14:30
Kasir: Arya
Pelanggan: Umum
--------------------------------
Produk A
2x @ 10.000          20.000
Produk B
1x @ 15.000          15.000
--------------------------------
Subtotal             35.000
PPN                   3.850
--------------------------------
TOTAL                38.850
Tunai                50.000
Kembali              11.150
--------------------------------
        Terima kasih
```

## Catatan

- Konfigurasi printer disimpan di tabel `settings` sebagai `printer_profiles`, `printer_default_id`, `printer_auto_print`, dan `printer_paper_size` per outlet.
- Laravel server harus berada di jaringan yang dapat menjangkau IP printer LAN.
- Print shift X/Z report tetap memakai `ThermalPrintService` (`generateShiftReportText`).
- Cash drawer kick tetap tersedia untuk USB/WebUSB (`ESC p`), dan bisa diperluas server-side untuk LAN jika dibutuhkan.
