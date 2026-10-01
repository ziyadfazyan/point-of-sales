// ESC/POS receipt generator + browser-side transport adapters.
// LAN printers are handled server-side by Laravel through registered printer IDs.

const ESC = 0x1b;
const GS = 0x1d;

function textBytes(text) {
    return Array.from(new TextEncoder().encode(text));
}

function buildReceiptBytes(data, paperSize = "80mm") {
    const width = paperSize === "58mm" ? 32 : 48;
    const bytes = [];

    // Init: ESC @, codepage off, no upside down
    bytes.push(ESC, 0x40);

    const center = (text) => {
        const pad = Math.max(0, Math.floor((width - text.length) / 2));
        bytes.push(...textBytes(" ".repeat(pad) + text + "\n"));
    };
    const leftRight = (l, r) => {
        const space = Math.max(1, width - l.length - r.length);
        bytes.push(...textBytes(l + " ".repeat(space) + r + "\n"));
    };
    const line = () => {
        bytes.push(...textBytes("-".repeat(width) + "\n"));
    };
    const emphasize = (on) => {
        bytes.push(ESC, 0x45, on ? 0x01 : 0x00);
    };

    emphasize(true);
    center(data.store_name || "TOKO");
    emphasize(false);
    if (data.store_address) center(data.store_address.slice(0, width));
    if (data.store_phone) center(`Telp: ${data.store_phone}`);
    line();
    leftRight(`#${data.invoice}`, data.created_at || "");
    if (data.cashier) leftRight("Kasir", data.cashier);
    if (data.customer_name) leftRight("Pelanggan", data.customer_name);
    if (data.order_type_label) leftRight("Tipe", data.order_type_label);
    line();

    for (const item of data.items || []) {
        const name = `${item.qty}x ${item.name}`.slice(0, width);
        bytes.push(...textBytes(name + "\n"));
        leftRight("", data.money(item.price));
    }

    line();
    leftRight("Subtotal", data.money(data.subtotal));
    if (data.discount_total > 0) leftRight("Diskon", `-${data.money(data.discount_total)}`);
    if (data.tax_total > 0) leftRight("PPN", data.money(data.tax_total));
    if (data.shipping_cost > 0) leftRight("Ongkir", data.money(data.shipping_cost));
    emphasize(true);
    leftRight("TOTAL", data.money(data.grand_total));
    emphasize(false);
    line();
    if (data.payment_method_label) leftRight("Bayar", data.payment_method_label);
    if (data.cash_received != null) leftRight("Tunai", data.money(data.cash_received));
    if (data.change > 0) leftRight("Kembali", data.money(data.change));
    if (data.note) bytes.push(...textBytes(`Cat: ${data.note.slice(0, width * 2)}\n`));
    line();
    center(data.footer || "Terima kasih!");
    bytes.push(...textBytes("\n\n"));

    // Cut: GS V 66 0
    bytes.push(GS, 0x56, 0x42, 0x00);
    return new Uint8Array(bytes);
}

function drawerKickBytes(pin = 2) {
    // ESC p m t1 t2 — kick drawer pin 2, ~50ms pulse
    return new Uint8Array([ESC, 0x70, pin === 5 ? 0x01 : 0x00, 0x19, 0xfa]);
}

function selectedPaperSize(printer, fallback = "80mm") {
    return printer?.paper_size || printer?.paperSize || fallback;
}

export async function requestPrinter() {
    if (!navigator.usb) {
        throw new Error("WebUSB tidak didukung browser ini. Gunakan Chrome/Edge.");
    }
    const device = await navigator.usb.requestDevice({
        filters: [],
    });
    try {
        await configurePrinter(device);
        getPrinter.cached = device;
        return device;
    } catch (error) {
        if (device.opened) await device.close();
        throw error;
    }
}

async function configurePrinter(device) {
    await device.open();
    if (device.configuration === null) {
        await device.selectConfiguration(1);
    }

    let interfaceNumber = null;
    let endpointNumber = null;
    const interfaces = device.configuration?.interfaces ?? [];
    const candidates = interfaces.flatMap((iface) =>
        iface.alternates.map((alt) => ({ iface, alt }))
    );
    const candidate =
        candidates.find(({ alt }) => alt.interfaceClass === 7) ||
        candidates.find(({ alt }) => alt.endpoints.some((e) => e.direction === "out"));
    const endpoint = candidate?.alt.endpoints.find((e) => e.direction === "out");
    if (candidate && endpoint) {
        interfaceNumber = candidate.iface.interfaceNumber;
        endpointNumber = endpoint.endpointNumber;
    }
    if (interfaceNumber === null || endpointNumber === null) {
        throw new Error("Tidak ditemukan interface output printer pada perangkat ini.");
    }
    await device.claimInterface(interfaceNumber);
    device._endpoint = endpointNumber;
}

async function getPrinter() {
    if (getPrinter.cached && getPrinter.cached.opened) {
        return getPrinter.cached;
    }
    // Re-attach to previously granted device
    if (!navigator.usb) throw new Error("WebUSB tidak didukung browser ini.");
    const devices = await navigator.usb.getDevices();
    if (devices.length === 0) return null;
    const device = devices[0];
    try {
        await configurePrinter(device);
        getPrinter.cached = device;
        return device;
    } catch (error) {
        if (device.opened) await device.close();
        throw error;
    }
}

export async function printBytes(bytes) {
    const device = await getPrinter();
    if (!device) throw new Error("Printer belum terhubung.");
    if (!device.opened || !device._endpoint) {
        throw new Error("Printer tidak siap menerima data. Hubungkan ulang printer.");
    }
    try {
        await device.transferOut(device._endpoint, bytes);
    } catch {
        getPrinter.cached = undefined;
        throw new Error("Gagal mengirim data ke printer. Periksa koneksi printer.");
    }
}

class BasePrinter {
    constructor(config = {}) {
        this.config = config;
    }

    async printReceipt(data, paperSize) {
        return this.printBytes(buildReceiptBytes(data, paperSize));
    }

    async testConnection() {
        throw new Error("Test koneksi belum tersedia untuk tipe printer ini.");
    }

    async printBytes() {
        throw new Error("Printer belum mendukung pengiriman ESC/POS.");
    }
}

export class UsbPrinter extends BasePrinter {
    async request() {
        return requestPrinter();
    }

    async testConnection() {
        await this.request();
        await this.printReceipt(testReceiptData(), selectedPaperSize(this.config));
    }

    async printBytes(bytes) {
        return printBytes(bytes);
    }
}

export class LanPrinter extends BasePrinter {
    async testConnection() {
        try {
            await window.axios.post(route("settings.printer.test", this.config.id));
        } catch (error) {
            throw new Error(error.response?.data?.message || "Test printer LAN gagal.");
        }
    }

    async printReceipt(_data, _paperSize, options = {}) {
        if (!options.invoice) {
            throw new Error("Invoice transaksi wajib tersedia untuk print LAN via Laravel.");
        }

        try {
            await window.axios.post(route("transactions.print.thermal", options.invoice), {
                printer_id: this.config.id,
            });
        } catch (error) {
            throw new Error(error.response?.data?.message || "Gagal mengirim struk ke printer LAN.");
        }
    }
}

export class BluetoothPrinter extends BasePrinter {
    async getCharacteristic() {
        if (!navigator.bluetooth) {
            throw new Error("Web Bluetooth tidak didukung browser ini.");
        }

        const serviceUuid = String(this.config.config?.service_uuid || "").trim();
        const characteristicUuid = String(this.config.config?.characteristic_uuid || "").trim();
        if (!serviceUuid || !characteristicUuid) {
            throw new Error("Web Bluetooth hanya bisa dipakai untuk printer BLE/GATT yang punya service UUID dan characteristic UUID.");
        }

        if (!BluetoothPrinter.cached) {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [serviceUuid] }],
                optionalServices: [serviceUuid],
            });
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(serviceUuid);
            BluetoothPrinter.cached = await service.getCharacteristic(characteristicUuid);
        }

        return BluetoothPrinter.cached;
    }

    async testConnection() {
        await this.printReceipt(testReceiptData(), selectedPaperSize(this.config));
    }

    async printBytes(bytes) {
        const characteristic = await this.getCharacteristic();
        const chunkSize = 180;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            await characteristic.writeValue(bytes.slice(offset, offset + chunkSize));
        }
    }
}

export class SystemPrinter extends BasePrinter {
    async testConnection(options = {}) {
        if (options.systemPrint) {
            options.systemPrint();
            return;
        }
        window.print();
    }

    async printReceipt(_data, _paperSize, options = {}) {
        if (options.systemPrint) {
            return options.systemPrint();
        }
        window.print();
    }
}

export class PrinterManager {
    constructor(printers = [], defaultPrinterId = null) {
        this.printers = printers;
        this.defaultPrinterId = defaultPrinterId;
    }

    selected(printer = null) {
        return printer || this.printers.find((item) => item.id === this.defaultPrinterId) || this.printers[0] || null;
    }

    adapter(printer = null) {
        const selected = this.selected(printer);
        if (!selected) {
            throw new Error("Belum ada printer yang dipilih.");
        }

        if (selected.type === "usb") return new UsbPrinter(selected);
        if (selected.type === "lan" || selected.type === "network") return new LanPrinter(selected);
        if (selected.type === "bluetooth_ble" || selected.type === "bluetooth") return new BluetoothPrinter(selected);

        return new SystemPrinter(selected);
    }

    async request(printer = null) {
        const adapter = this.adapter(printer);
        if (adapter.request) return adapter.request();
        return adapter.testConnection();
    }

    async testConnection(printer = null, options = {}) {
        return this.adapter(printer).testConnection(options);
    }

    async printReceipt(data, printer = null, options = {}) {
        const selected = this.selected(printer);
        return this.adapter(selected).printReceipt(data, selectedPaperSize(selected), options);
    }
}

function testReceiptData() {
    return {
        store_name: "TEST PRINT",
        invoice: "TEST-001",
        created_at: new Date().toLocaleString("id-ID"),
        items: [{ qty: 1, name: "Produk Uji Cetak", price: 1000 }],
        money: (v) => `Rp${Number(v || 0).toLocaleString("id-ID")}`,
        subtotal: 1000,
        discount_total: 0,
        tax_total: 0,
        shipping_cost: 0,
        grand_total: 1000,
        payment_method_label: "Tunai",
        cash_received: 1000,
        change: 0,
    };
}

export async function printReceipt(data, paperSizeOrPrinter = "80mm", printer = null) {
    if (typeof paperSizeOrPrinter === "object" && paperSizeOrPrinter !== null) {
        return new PrinterManager([paperSizeOrPrinter], paperSizeOrPrinter.id).printReceipt(data, paperSizeOrPrinter);
    }

    if (printer) {
        return new PrinterManager([printer], printer.id).printReceipt(data, printer);
    }

    await printBytes(buildReceiptBytes(data, paperSizeOrPrinter));
}

export async function kickDrawer() {
    await printBytes(drawerKickBytes());
}

export async function disconnectPrinter() {
    if (getPrinter.cached) {
        try {
            await getPrinter.cached.close();
        } finally {
            getPrinter.cached = undefined;
        }
    }
}

export function hasCachedPrinter() {
    return Boolean(getPrinter.cached?.opened);
}

export function canAutoPrint(printer) {
    if (!printer) return hasCachedPrinter();
    if (printer.type === "lan" || printer.type === "network") return true;
    if (printer.type === "usb") return hasCachedPrinter();
    if (printer.type === "bluetooth_ble" || printer.type === "bluetooth") return Boolean(BluetoothPrinter.cached);

    return false;
}

export { buildReceiptBytes, drawerKickBytes, testReceiptData };
