using System;
using System.IO;
using System.Reflection;

namespace NavisworksMCP.Core
{
    /// <summary>
    /// 相依組件解析器。
    ///
    /// Navisworks Manage 2020 主目錄內建 Newtonsoft.Json 6.0.0.0，會先被載入進程；
    /// 本外掛編譯時綁 13.0.0.0，CLR 在 app base 找到舊版後判定 manifest 不符而綁定失敗
    /// （錯誤訊息：The located assembly's manifest definition does not match the assembly reference）。
    ///
    /// 綁定失敗時由此改從外掛自身資料夾載入正確版本；同名不同版的組件可於同一 AppDomain 並存，
    /// 因此不會影響 Navisworks 既有的 6.0.0.0。
    /// </summary>
    internal static class AssemblyResolver
    {
        private static readonly object Gate = new object();
        private static bool _registered;

        /// <summary>註冊解析器（可重複呼叫，只會生效一次）</summary>
        public static void Register()
        {
            lock (Gate)
            {
                if (_registered) return;
                AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;
                _registered = true;
                Logger.Info("AssemblyResolve 解析器已註冊");
            }
        }

        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            try
            {
                var requested = new AssemblyName(args.Name);

                // 已載入同名同版就直接回傳，避免重複載入
                foreach (var loaded in AppDomain.CurrentDomain.GetAssemblies())
                {
                    var loadedName = loaded.GetName();
                    if (string.Equals(loadedName.Name, requested.Name, StringComparison.OrdinalIgnoreCase)
                        && loadedName.Version == requested.Version)
                    {
                        return loaded;
                    }
                }

                var pluginDir = Path.GetDirectoryName(typeof(AssemblyResolver).Assembly.Location);
                if (string.IsNullOrEmpty(pluginDir)) return null;

                var candidate = Path.Combine(pluginDir, requested.Name + ".dll");
                if (!File.Exists(candidate)) return null;

                // 確認版本相符才載入，避免又載到不對的版本
                var candidateName = AssemblyName.GetAssemblyName(candidate);
                if (requested.Version != null && candidateName.Version != requested.Version)
                {
                    Logger.Warn($"AssemblyResolve: {requested.Name} 版本不符 " +
                                $"(需要 {requested.Version}，外掛資料夾為 {candidateName.Version})");
                    return null;
                }

                Logger.Info($"AssemblyResolve: 由外掛資料夾載入 {requested.Name} {candidateName.Version}");
                return Assembly.LoadFrom(candidate);
            }
            catch (Exception ex)
            {
                Logger.Error($"AssemblyResolve 處理 '{args.Name}' 時失敗", ex);
                return null;
            }
        }
    }
}
