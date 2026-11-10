// Agent 面板桥接插件的运行时模块：编辑器、PIE、-game / 专用服务器进程里都加载（Shipping 不加载，见 .uplugin）
using System;
using System.IO;
using System.Text.RegularExpressions;
using UnrealBuildTool;

public class AgentPanelBridge : ModuleRules
{
	public AgentPanelBridge(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"HTTPServer", "Json", "JsonUtilities", "AssetRegistry", "ImageCore"
		});
		// Shipping 里一律不编进去：.uplugin 已经拦了加载，这里再保证代码不在
		if (Target.Configuration == UnrealTargetConfiguration.Shipping)
		{
			PublicDefinitions.Add("AGENT_PANEL_BRIDGE_ENABLED=0");
		}
		else
		{
			PublicDefinitions.Add("AGENT_PANEL_BRIDGE_ENABLED=1");
		}
		SetupLua(Target);
	}

	/**
	 * UnLua 是可选的：项目里有 UnLua 插件（且没在 .uproject 里关掉）才编进 Lua 支持，没有时这些代码整个不编译。
	 * 读写都走 Lua 的 C 接口；只有「拿 lua_State」要用 UnLua 的接口，各版本、改过的分支接口名不一样，
	 * 这里扫 UnLua 的头文件看有哪个就用哪个（AgentPanelLua.cpp 里按这几个宏选），都没有时项目用 FAgentPanelLua::SetStateProvider 提供
	 */
	private void SetupLua(ReadOnlyTargetRules Target)
	{
		string UnLuaDir = FindUnLua(Target);
		if (UnLuaDir == null)
		{
			PublicDefinitions.Add("AGENT_PANEL_WITH_LUA=0");
			return;
		}
		string Headers = ReadHeaders(Path.Combine(UnLuaDir, "Source"));
		bool bMainState = Headers.Contains("GetMainState");
		bool bEnvByObject = bMainState && Regex.IsMatch(Headers, @"FLuaEnv\s*\*\s*GetEnv\s*\(\s*(const\s+)?UObject\s*\*");
		bool bEnv = bMainState && Regex.IsMatch(Headers, @"FLuaEnv\s*\*\s*GetEnv\s*\(\s*\)");
		bool bGetState = Regex.IsMatch(Headers, @"lua_State\s*\*\s*GetState\s*\(\s*\)");
		PublicDefinitions.Add("AGENT_PANEL_WITH_LUA=1");
		PrivateDefinitions.Add("AGENT_PANEL_UNLUA_ENV_BY_OBJECT=" + (bEnvByObject ? "1" : "0"));
		PrivateDefinitions.Add("AGENT_PANEL_UNLUA_ENV=" + (bEnv ? "1" : "0"));
		PrivateDefinitions.Add("AGENT_PANEL_UNLUA_GETSTATE=" + (bGetState ? "1" : "0"));
		PrivateDependencyModuleNames.Add("UnLua");
		// Lua 本体是 UnLua 带的第三方模块（lua.hpp 在里面）；改过的分支可能改了名字，找不到时靠 UnLua 模块公开的依赖
		if (FindFile(UnLuaDir, "Lua.Build.cs") != null)
		{
			PrivateDependencyModuleNames.Add("Lua");
		}
		Console.WriteLine("AgentPanelBridge: 找到 UnLua（" + UnLuaDir + "），编进 Lua 支持；GetEnv(UObject)=" + bEnvByObject + " GetEnv()=" + bEnv + " GetState()=" + bGetState);
	}

	private string FindUnLua(ReadOnlyTargetRules Target)
	{
		if (Target.ProjectFile == null)
		{
			return null;
		}
		string ProjectDir = Target.ProjectFile.Directory.FullName;
		// .uproject 里明确关掉了 UnLua：当没有处理，不因为桥接把它重新带起来
		try
		{
			string UProject = File.ReadAllText(Target.ProjectFile.FullName);
			if (Regex.IsMatch(UProject, "\"Name\"\\s*:\\s*\"UnLua\"\\s*,\\s*\"Enabled\"\\s*:\\s*false"))
			{
				return null;
			}
		}
		catch (Exception)
		{
		}
		string Found = FindFile(Path.Combine(ProjectDir, "Plugins"), "UnLua.uplugin");
		if (Found == null)
		{
			Found = FindFile(Path.Combine(EngineDirectory, "Plugins", "Marketplace"), "UnLua.uplugin");
		}
		return Found == null ? null : Path.GetDirectoryName(Found);
	}

	private static string FindFile(string Dir, string Name)
	{
		if (!Directory.Exists(Dir))
		{
			return null;
		}
		try
		{
			string[] Files = Directory.GetFiles(Dir, Name, SearchOption.AllDirectories);
			return Files.Length > 0 ? Files[0] : null;
		}
		catch (Exception)
		{
			return null;
		}
	}

	private static string ReadHeaders(string Dir)
	{
		string All = "";
		if (!Directory.Exists(Dir))
		{
			return All;
		}
		try
		{
			foreach (string F in Directory.GetFiles(Dir, "*.h", SearchOption.AllDirectories))
			{
				// 第三方的 Lua 源码不用扫
				if (F.Replace('\\', '/').Contains("/ThirdParty/"))
				{
					continue;
				}
				All += File.ReadAllText(F) + "\n";
			}
		}
		catch (Exception)
		{
		}
		return All;
	}
}
