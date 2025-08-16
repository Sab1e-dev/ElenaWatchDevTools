import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { ColorUtils } from './ColorUtils';

interface setOptions {
    terminalRXColor?: string;
    terminalTXColor?: string;
}

export class SerialTerminal {
    public static onConnect: ((serialPort: SerialPort) => void) | null = null;
    public static onDisconnect: (() => void) | null = null;
    private static terminal: vscode.Terminal | null = null;
    private static serialPort: SerialPort | null = null;
    private static inputBuffer: string = '';
    private static emitter: vscode.EventEmitter<string> | null = null;
    private static isSending: boolean = false;

    private static commandHistory: string[] = [];
    private static historyIndex: number = -1; // 当前显示的历史命令索引
    private static currentCommandBeforeHistory: string = ''; // 进入历史记录前的命令

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
    // 在串口终端打印一行内容
    public static appendLine(value: string): void {
        SerialTerminal.emitter?.fire(`\r\n${value}`);
    }
    // 在串口终端打印内容
    public static append(value: string): void {
        SerialTerminal.emitter?.fire(`${value}`);
    }
    // 通过串口发送指定内容
    public static send(value: string): void {
        SerialTerminal.emitter?.fire(`\r\n${value}`);
        const val = '\r' + value + '\r';
        SerialTerminal.serialPort!.write(val, (err) => {
            if (err) {
                const timestamp = new Date().toLocaleTimeString();
                this.emitter?.fire(`\r\n\x1B[31m[${timestamp}] TX失败: ${err.message}${ColorUtils.getResetCode()}`);
            }
        });
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
        
        // 处理上下箭头键（历史命令导航）
        if (data === '\x1B[A' || data === '\x1B[B') { // 上箭头: \x1B[A, 下箭头: \x1B[B
            this.handleArrowKeys(data);
            return;
        }
        
        // 回车键
        if (data.charCodeAt(0) === 13) {
            if (this.inputBuffer.length === 0) {
                return;
            }
            
            // 添加到命令历史
            this.addToCommandHistory(this.inputBuffer);
            
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
            // 如果当前在历史记录中，输入新字符则退出历史记录模式
            if (this.historyIndex !== -1) {
                this.exitHistoryMode();
            }
            
            this.inputBuffer += data;
            this.emitter?.fire(`${this.TXColorCode}${data}${ColorUtils.getResetCode()}`);
        }
    }

    // 新增方法：处理上下箭头键
    private static handleArrowKeys(data: string): void {
        // 上箭头
        if (data === '\x1B[A') {
            // 如果当前没有在历史记录中，保存当前命令
            if (this.historyIndex === -1) {
                this.currentCommandBeforeHistory = this.inputBuffer;
            }
            
            // 尝试向上移动历史记录
            const newIndex = this.historyIndex < this.commandHistory.length - 1 
                ? this.historyIndex + 1 
                : this.historyIndex;
            
            if (newIndex !== this.historyIndex) {
                this.historyIndex = newIndex;
                this.showHistoryCommand();
            }
        }
        // 下箭头
        else if (data === '\x1B[B') {
            // 尝试向下移动历史记录
            const newIndex = this.historyIndex > -1 
                ? this.historyIndex - 1 
                : this.historyIndex;
            
            if (newIndex !== this.historyIndex) {
                this.historyIndex = newIndex;
                this.showHistoryCommand();
            }
        }
    }

    // 新增方法：显示历史命令
    private static showHistoryCommand(): void {
        if (this.historyIndex === -1) {
            // 回到原始命令
            this.inputBuffer = this.currentCommandBeforeHistory;
        } else {
            // 显示历史命令
            this.inputBuffer = this.commandHistory[this.commandHistory.length - 1 - this.historyIndex];
        }
        
        // 清除当前行并重新显示命令
        this.clearCurrentLine();
        this.emitter?.fire(`${this.TXColorCode}${this.inputBuffer}${ColorUtils.getResetCode()}`);
    }

    // 新增方法：退出历史记录模式
    private static exitHistoryMode(): void {
        this.historyIndex = -1;
        this.currentCommandBeforeHistory = '';
    }

    // 新增方法：清除当前行
    private static clearCurrentLine(): void {
        // 发送回车到行首
        this.emitter?.fire('\r');
        // 发送清除整行序列
        this.emitter?.fire('\x1B[2K');
    }

    // 新增方法：添加到命令历史
    private static addToCommandHistory(command: string): void {
        // 不添加空命令
        if (!command.trim()) return;
        
        // 不添加重复命令（与最后一条相同）
        if (this.commandHistory.length > 0 && 
            this.commandHistory[this.commandHistory.length - 1] === command) {
            return;
        }
        
        this.commandHistory.push(command);
        
        // 限制历史记录长度（例如100条）
        if (this.commandHistory.length > 100) {
            this.commandHistory.shift();
        }
        
        // 重置历史索引
        this.historyIndex = -1;
        this.currentCommandBeforeHistory = '';
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