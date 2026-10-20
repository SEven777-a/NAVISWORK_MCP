import WebSocket from "ws";

export interface NavisCommand {
  command: string;
  parameters: Record<string, unknown>;
  requestId: string;
}

export interface NavisResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  requestId: string;
}

export class NavisSocketClient {
  private ws: WebSocket | null = null;
  private responseHandlers: Map<string, (response: NavisResponse) => void> =
    new Map();
  private reconnectInterval: NodeJS.Timeout | null = null;
  private readonly port: number;

  constructor() {
    this.port = parseInt(process.env.NAVIS_MCP_PORT || "2233", 10);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("連接超時 (10秒)"));
      }, 10000);

      try {
        this.ws = new WebSocket(`ws://localhost:${this.port}/`);

        this.ws.on("open", () => {
          clearTimeout(timeout);
          console.error(`[NavisMCP] 已連接到 Navisworks Add-in (port ${this.port})`);
          if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
          }
          resolve();
        });

        this.ws.on("message", (data) => {
          try {
            const response: NavisResponse = JSON.parse(data.toString());
            const handler = this.responseHandlers.get(response.requestId);
            if (handler) {
              handler(response);
              this.responseHandlers.delete(response.requestId);
            }
          } catch (err) {
            console.error("[NavisMCP] 解析回應失敗:", err);
          }
        });

        this.ws.on("close", () => {
          console.error("[NavisMCP] 連接已關閉，嘗試重連...");
          this.startReconnect();
        });

        this.ws.on("error", (err) => {
          clearTimeout(timeout);
          console.error("[NavisMCP] WebSocket 錯誤:", err.message);
          reject(err);
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  private startReconnect(): void {
    if (this.reconnectInterval) return;
    this.reconnectInterval = setInterval(async () => {
      try {
        await this.connect();
      } catch {
        // 靜默重試
      }
    }, 5000);
  }

  async sendCommand(
    command: string,
    parameters: Record<string, unknown> = {}
  ): Promise<NavisResponse> {
    if (!this.isConnected()) {
      try {
        await this.connect();
      } catch {
        throw new Error(
          "無法連接到 Navisworks。請確認 Navisworks 已開啟且 MCP 服務已啟動 (port 2233)"
        );
      }
    }

    const requestId = this.generateRequestId();
    const cmd: NavisCommand = {
      command,
      // 參數鍵維持 camelCase：C# 端 CommandExecutor 以 parameters["groupBy"] 這類
      // camelCase 鍵讀取，而 Dictionary 查找是大小寫敏感的，轉成 PascalCase 會全部對不到，
      // 導致所有參數被忽略而靜默套用預設值。
      parameters,
      requestId,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseHandlers.delete(requestId);
        reject(new Error(`命令超時 (30秒): ${command}`));
      }, 30000);

      this.responseHandlers.set(requestId, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.ws!.send(JSON.stringify(cmd));
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

}
