using Newtonsoft.Json;

namespace NavisworksMCP.Models
{
    /// <summary>
    /// 回傳給 MCP Server 的命令回應。
    ///
    /// 欄位名稱必須是 camelCase：MCP Server 端 (socket.ts) 以 response.requestId 配對
    /// 等待中的請求，若輸出預設的 PascalCase 會配不到 handler，造成每個命令都逾時。
    /// 這裡用 JsonProperty 逐一指定，而非設定全域 CamelCase 解析器 —— 後者會連 Data
    /// 內的字典鍵一併轉換，破壞 Navisworks 屬性名稱（如 "Source File"、"Element"）。
    /// </summary>
    public class NavisCommandResponse
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("data")]
        public object Data { get; set; }

        [JsonProperty("error")]
        public string Error { get; set; }

        [JsonProperty("requestId")]
        public string RequestId { get; set; }
    }
}
