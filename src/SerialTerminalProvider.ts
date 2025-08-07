import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

interface setOptions {
    terminalRXColor?: string;
    terminalTXColor?: string;
}

class ColorUtils {
    private static colorMap: Record<string, string> = {
        default: '\x1B[0m',
        black: '\x1B[30m',
        red: '\x1B[31m',
        green: '\x1B[32m',
        yellow: '\x1B[33m',
        blue: '\x1B[34m',
        magenta: '\x1B[35m',
        cyan: '\x1B[36m',
        white: '\x1B[37m',
        gray: '\x1B[90m',
        brightRed: '\x1B[91m',
        brightGreen: '\x1B[92m',
        brightYellow: '\x1B[93m',
        brightBlue: '\x1B[94m',
        brightMagenta: '\x1B[95m',
        brightCyan: '\x1B[96m',
        brightWhite: '\x1B[97m'
    };

    public static getColorCode(colorName: string): string {
        return this.colorMap[colorName] || this.colorMap.default;
    }

    public static getResetCode(): string {
        return this.colorMap.default;
    }

    /**
     * 将字符串转换为彩虹色效果
     * @param text 输入文本
     * @param options 配置选项
     * @returns 带彩虹色效果的字符串
     */
    public static rainbowText(text: string, options?: {
        colors?: string[];       // 自定义颜色序列
        loop?: boolean;          // 是否循环使用颜色
        bold?: boolean;          // 是否加粗
        underline?: boolean;     // 是否下划线
    }): string {
        const defaultColors = [
            '\x1B[91m', // 亮红
            '\x1B[93m', // 亮黄
            '\x1B[92m', // 亮绿
            '\x1B[96m', // 亮青
            '\x1B[94m', // 亮蓝
            '\x1B[95m',  // 亮紫
        ];

        const {
            colors = defaultColors,
            loop = true,
            bold = false,
            underline = false
        } = options || {};

        if (!text || colors.length === 0) return text;

        // 添加样式前缀
        let stylePrefix = '';
        if (bold) stylePrefix += '\x1B[1m';
        if (underline) stylePrefix += '\x1B[4m';

        // 处理每个字符
        let result = '';
        let colorIndex = 0;

        for (const char of text) {
            if (char === ' ') {
                result += char;
                continue;
            }

            const color = colors[colorIndex % colors.length];
            result += `${stylePrefix}${color}${char}${this.getResetCode()}`;

            if (loop || colorIndex < colors.length - 1) {
                colorIndex++;
            }
        }
        return result;
    }
}

export class SerialTerminal {
    public static onConnect: ((serialPort: SerialPort) => void) | null = null;
    public static onDisconnect: (() => void) | null = null;
    private static terminal: vscode.Terminal | null = null;
    private static serialPort: SerialPort | null = null;
    private static inputBuffer: string = '';
    private static emitter: vscode.EventEmitter<string> | null = null;
    private static isSending: boolean = false;

    private static RXColorCode: string = ColorUtils.getColorCode('default');
    private static TXColorCode: string = ColorUtils.getColorCode('default');
    public static set(options: setOptions) {
        if (options.terminalRXColor !== undefined) {
            this.RXColorCode = ColorUtils.getColorCode(options.terminalRXColor);
        }
        if (options.terminalTXColor !== undefined) {
            this.TXColorCode = ColorUtils.getColorCode(options.terminalTXColor);
        }
    }

    static create(portPath: string, baudRate: number): void {
        if (this.terminal) {
            this.terminal.show();
            return;
        }

        this.emitter = new vscode.EventEmitter<string>();

        this.terminal = vscode.window.createTerminal({
            name: `串口终端 - ${portPath}`,
            pty: {
                onDidWrite: this.emitter.event,
                open: () => {
                    this.connectSerialPort(portPath, baudRate);
                    this.emitter?.fire(ColorUtils.rainbowText("[Elena Watch 开发工具] 串口终端启动成功\r\n"));
                },
                close: () => this.disconnectSerialPort(),
                handleInput: (data: string) => this.handleUserInput(data)
            }
        });

        this.terminal.show();
    }
    public static show(): void {
        SerialTerminal.terminal?.show();
    }
    public static appendLine(value: string): void {
        SerialTerminal.emitter?.fire(`\r\n${value}`);
    }
    public static append(value: string): void {
        SerialTerminal.emitter?.fire(`${value}`);
    }
    private static connectSerialPort(portPath: string, baudRate: number): void {
        this.serialPort = new SerialPort({ path: portPath, baudRate });


        this.serialPort.on('data', (data: Buffer) => {
            this.emitter?.fire(`${this.RXColorCode}${data.toString()}${ColorUtils.getResetCode()}`);
        });


        this.serialPort.on('error', (err) => {
            vscode.window.showErrorMessage(`[EWDT] ${err.message}`);
            this.disconnectSerialPort();
        });

        // 物理拔出或串口关闭事件
        this.serialPort.on('close', () => {
            this.emitter?.fire(`\r\n\x1B[31m[INFO] 串口已物理断开或关闭${ColorUtils.getResetCode()}`);
            this.disconnectSerialPort();
        });

        // 连接成功事件
        if (SerialTerminal.onConnect) {
            SerialTerminal.onConnect(this.serialPort);
        }
    }

    private static handleUserInput(data: string): void {
        if (this.isSending) return;
        // 回车键
        if (data.charCodeAt(0) === 13) {
            if (this.inputBuffer.length === 0) {
                return;
            }
            this.isSending = true;
            const command = this.inputBuffer;
            this.inputBuffer = '';
            this.sendToSerial(command + '\n', () => {
                this.isSending = false;
            });
            this.emitter?.fire(`\r`);
        }
        // 退格键
        else if (data.charCodeAt(0) === 127) {
            if (this.inputBuffer.length > 0) {
                this.inputBuffer = this.inputBuffer.slice(0, -1);
                this.emitter?.fire('\b \b');
            }
        }
        // 普通字符
        else {
            this.inputBuffer += data;
            this.emitter?.fire(`${this.TXColorCode}${data}${ColorUtils.getResetCode()}`);
        }
    }

    private static sendToSerial(data: string, callback: () => void): void {
        if (!this.serialPort?.writable) {
            callback();
            return;
        }

        this.serialPort.write(data, (err) => {
            if (err) {
                const timestamp = new Date().toLocaleTimeString();
                this.emitter?.fire(`\r\n\x1B[31m[${timestamp}] TX失败: ${err.message}${ColorUtils.getResetCode()}`);
            }
            callback();
        });
    }

    private static disconnectSerialPort(): void {
        this.serialPort?.close();
        this.serialPort = null;
        vscode.window.showInformationMessage('串口连接已断开');
        this.emitter?.dispose();
        this.terminal?.dispose();
        this.terminal = null;
        // 断开事件
        if (SerialTerminal.onDisconnect) {
            SerialTerminal.onDisconnect();
        }
    }

    public static isConnected(): boolean {
        return !!this.serialPort && this.serialPort.isOpen;
    }

    public static disconnect(): void {
        this.disconnectSerialPort();
    }
}