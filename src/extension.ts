import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { SerialTerminal } from './SerialTerminalProvider';
import { transfer, SerialPortLike } from './ymodem';
import * as path from 'path';
import { ColorUtils } from './ColorUtils';

let serialPort: SerialPort | null = null;
export let outputChannel: SerialTerminal;

let connectStatusBarItem: vscode.StatusBarItem;
let sendFileStatusBarItem: vscode.StatusBarItem;
let resetBoardStatusBarItem: vscode.StatusBarItem;
let runJSCodeStatusBarItem: vscode.StatusBarItem;

export let debugMode: boolean;
let jsStackSize: number;
let defaultBaudRate: number;

function createSerialPortWrapper(port: SerialPort): SerialPortLike {
    return {
        write: (data: Buffer | Uint8Array) => new Promise((resolve, reject) => {
            port.write(data, (err) => err ? reject(err) : resolve());
        }),
        on: (event: string, callback: (data: Buffer) => void) => {
            port.on('data', callback);
        },
        removeListener: (event: string, callback: (data: Buffer) => void) => {
            port.off('data', callback);
        },
        isOpen: port.isOpen
    };
}

function updateConfig() {
    const config = vscode.workspace.getConfiguration('ewdt');
    if (config.get('terminalRXColor') !== undefined) {
        SerialTerminal.set({ terminalRXColor: config.get('terminalRXColor') });
    }
    if (config.get('terminalTXColor') !== undefined) {
        SerialTerminal.set({ terminalTXColor: config.get('terminalTXColor') });
    }
    if (config.get('debugMode') !== undefined) {
        debugMode = config.get('debugMode') ?? false;
    }
    if (config.get("jsStackSize") !== undefined) {
        jsStackSize = config.get('jsStackSize') ?? 1024;
    }
    if (config.get("defaultBaudRate") !== undefined) {
        defaultBaudRate = config.get('defaultBaudRate') ?? 115200;
    }
}

async function sendFile(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const filePath = fileUri.fsPath;
        const fileData = await vscode.workspace.fs.readFile(fileUri);

        SerialTerminal.show();
        SerialTerminal.appendLine(`准备发送文件: ${filePath}`);

        const serialWrapper = createSerialPortWrapper(serialPort!);

        const logger = (msg: string) => SerialTerminal.appendLine(msg);
        const onProgress = ([current, total]: [number, number]) => {
            vscode.window.setStatusBarMessage(`YMODEM 进度: ${current}/${total} 包`, 2000);
        };

        await transfer(
            serialWrapper,
            path.basename(filePath),
            Buffer.from(fileData),
            onProgress,
            SerialTerminal.appendLine
        );

        vscode.window.showInformationMessage('文件发送成功！');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        SerialTerminal.appendLine(`[ERROR] ${msg}`);
        vscode.window.showErrorMessage(`文件发送失败: ${msg}`);
    }
    return false;
}

export function activate(context: vscode.ExtensionContext) {
    updateConfig();
    // 状态栏按钮初始化
    // 连接串口按钮
    connectStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    connectStatusBarItem.text = '$(elena-watch)  连接到 Elena Watch';
    connectStatusBarItem.tooltip = '连接串口';
    connectStatusBarItem.command = 'ewdt.serial.createTerminal';
    connectStatusBarItem.show();
    context.subscriptions.push(connectStatusBarItem);
    // 发送文件按钮
    sendFileStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        101
    )
    sendFileStatusBarItem.text = '$(file-symlink-file) 发送文件'
    sendFileStatusBarItem.tooltip = '使用YMODEM协议通过串口发送文件到设备';
    sendFileStatusBarItem.command = 'ewdt.serial.sendFile';
    // 重置开发板按钮
    resetBoardStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        102
    );
    resetBoardStatusBarItem.text = '$(sync) 重置开发板';
    resetBoardStatusBarItem.tooltip = '重置开发板';
    resetBoardStatusBarItem.command = 'ewdt.serial.resetBoard';
    // 下载并运行 JS 代码按钮
    runJSCodeStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        103
    );
    runJSCodeStatusBarItem.text = '$(debug-start) 运行JS';
    runJSCodeStatusBarItem.tooltip = '通过串口发送当前打开的JS代码并运行';
    runJSCodeStatusBarItem.command = 'ewdt.serial.runJS';

    // 连接事件：修改按钮为断开
    SerialTerminal.onConnect = (onConnectSerialPort: SerialPort) => {
        connectStatusBarItem.text = '$(debug-disconnect) 断开 Elena Watch';
        connectStatusBarItem.tooltip = '断开串口';
        connectStatusBarItem.command = 'ewdt.serial.disconnectTerminal';
        serialPort = onConnectSerialPort; // 保存当前串口实例
        sendFileStatusBarItem.show();
        resetBoardStatusBarItem.show();
        runJSCodeStatusBarItem.show();
    };
    // 断开事件：修改按钮为连接
    SerialTerminal.onDisconnect = () => {
        connectStatusBarItem.text = '$(elena-watch)  连接到 Elena Watch';
        connectStatusBarItem.tooltip = '连接串口';
        connectStatusBarItem.command = 'ewdt.serial.createTerminal';
        sendFileStatusBarItem.hide();
        resetBoardStatusBarItem.hide();
        runJSCodeStatusBarItem.hide();
        serialPort = null; // 清除当前串口实例
    };

    // 创建串口终端命令
    const createTerminalHandler = async () => {
        if (SerialTerminal.isConnected()) {
            vscode.window.showWarningMessage('串口已连接！');
            return;
        }
        try {
            const ports = await SerialPort.list();
            const selectedPort = await vscode.window.showQuickPick(
                ports.map(port => ({
                    label: port.path,
                    description: port.manufacturer || 'Unknown',
                    detail: `PID: ${port.productId || 'N/A'}, VID: ${port.vendorId || 'N/A'}`
                })),
                { placeHolder: 'Select a serial port...' }
            );

            if (!selectedPort) return;

            const baudRate = await vscode.window.showInputBox({
                prompt: 'Enter baud rate (e.g., 9600, 115200)',
                value: defaultBaudRate.toString()
            });

            if (!baudRate) return;

            SerialTerminal.create(selectedPort.label, parseInt(baudRate));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create serial terminal: ${error}`);
        }
    };

    // 断开串口命令
    const disconnectTerminalHandler = () => {
        if (SerialTerminal.isConnected()) {
            SerialTerminal.disconnect();
        } else {
            vscode.window.showWarningMessage('串口未连接！');
        }
    };

    const sendFileHandler = async () => {
        if (!serialPort?.isOpen) {
            vscode.window.showErrorMessage('请先连接串口！');
            return;
        }

        // 获取当前活动文件和所有已打开文件
        const activeEditor = vscode.window.activeTextEditor;
        const activeFile = activeEditor?.document.uri;

        // 获取所有标签页文件（包括未聚焦的）
        const allTabFiles = vscode.window.tabGroups.all.flatMap(group =>
            group.tabs
                .filter(tab => tab.input instanceof vscode.TabInputText)
                .map(tab => (tab.input as vscode.TabInputText).uri)
                .filter(uri => uri.scheme === 'file')
        );

        // 去重并排除活动文件
        const uniqueFiles = Array.from(new Set(allTabFiles.map(uri => uri.fsPath)))
            .map(fsPath => vscode.Uri.file(fsPath))
            .filter(uri => activeFile ? uri.fsPath !== activeFile.fsPath : true);

        // 构造 QuickPick 选项
        const quickPickItems: vscode.QuickPickItem[] = [];
        if (activeFile) {
            quickPickItems.push({
                label: `当前文件: ${path.basename(activeFile.fsPath)}`,
                description: activeFile.fsPath,
                detail: '正在编辑的文件'
            });
        }
        quickPickItems.push({
            label: '选择其他文件...',
            description: '',
            detail: '从文件系统选择'
        });
        for (const uri of uniqueFiles) {
            quickPickItems.push({
                label: `已打开: ${path.basename(uri.fsPath)}`,
                description: uri.fsPath,
                detail: '已打开但非焦点文件'
            });
        }

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: '选择要发送的文件'
        });
        if (!selected) return;

        let fileUri: vscode.Uri | undefined;
        if (selected.label === '选择其他文件...') {
            const fileDialog = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: '选择要发送的文件'
            });
            if (!fileDialog?.[0]) return;
            fileUri = fileDialog[0];
        } else {
            fileUri = vscode.Uri.file(selected.description!);
        }
        sendFile(fileUri);
        SerialTerminal.show();
    }

    const resetBoardHandler = async () => {
        if (!serialPort?.isOpen) {
            vscode.window.showErrorMessage('请先连接串口！');
            return;
        }

        // 发送重置命令
        serialPort.set({ rts: true });
        await new Promise(resolve => setTimeout(resolve, 100)); // 保持100ms
        serialPort.set({ rts: false });
        vscode.window.showInformationMessage('重置成功！');
    }

    const runJSHandler = async () => {
        if (!serialPort?.isOpen) {
            vscode.window.showErrorMessage('请先连接串口！');
            return;
        }

        // 获取当前活动文件和所有已打开文件
        const activeEditor = vscode.window.activeTextEditor;
        const activeFile = activeEditor?.document.uri;
        if (!activeEditor) {
            vscode.window.showErrorMessage('没有活动的编辑器！');
            return;
        }
        await activeEditor.document.save();
        SerialTerminal.send('yrcv');
        await sendFile(activeFile!);
        SerialTerminal.send('js --stop');
        SerialTerminal.send(`js ${path.basename(activeFile?.fsPath!)} --stack ${jsStackSize}`);
    }

    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.createTerminal', createTerminalHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.disconnectTerminal', disconnectTerminalHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.sendFile', sendFileHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.resetBoard', resetBoardHandler));
    context.subscriptions.push(vscode.commands.registerCommand('ewdt.serial.runJS', runJSHandler));

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ewdt')) {
                updateConfig();
                vscode.window.showInformationMessage("[EWDT] 配置已更新")
            }
        })
    );
}

export function deactivate() {
    if (serialPort?.isOpen) {
        serialPort.close();
    }
}
