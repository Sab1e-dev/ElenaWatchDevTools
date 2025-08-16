
export class ColorUtils {
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