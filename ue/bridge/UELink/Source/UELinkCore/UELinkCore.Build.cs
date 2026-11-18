// UELink 的运行时模块（原 Agent 面板桥接 AgentPanelBridge）：编辑器、PIE、-game / 专用服务器进程里都加载（Shipping 不加载，见 .uplugin）
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using UnrealBuildTool;

public class UELinkCore : ModuleRules
{
	public UELinkCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine" });
		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"HTTPServer", "Json", "JsonUtilities", "AssetRegistry", "ImageCore", "UMG", "Slate", "SlateCore",
			// 实时性能读数（AgentPanelPerf.cpp）：stat unit 用的线程时间在 RenderCore，GPU 时间和 Draw Calls 在 RHI
			"RenderCore", "RHI",
			// GameplayTag 浏览（UELinkConfigOps.cpp）：引擎运行时模块，不是插件，每个项目都有
			"GameplayTags",
			// Lua 函数进 trace（AgentPanelLuaTrace.cpp）：自定义 Trace 通道（UE_TRACE_CHANNEL_DEFINE）的 FChannel::Setup 在 TraceLog 模块里，
			// Core 只是把它当私有依赖用，不传给我们，不加这一行 5.8 上链接报 LNK2019（2.9.0 实际报过）；5.4 起都有这个模块
			"TraceLog"
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
		RejectOldPlugins(Target);
	}

	/**
	 * UELink 是 AgentPanelBridge（Agent 面板）和 UEToVSLink（UEToVS）合并来的：旧插件还在项目里时两边都挂日志、抢 Live Coding，
	 * 旧桥接的类名还会和这里重复（单体编译直接链接冲突）。编译时就拦下，报清楚要删哪个目录，不留到运行时才出怪问题
	 */
	private void RejectOldPlugins(ReadOnlyTargetRules Target)
	{
		if (Target.ProjectFile == null)
		{
			return;
		}
		string Plugins = Path.Combine(Target.ProjectFile.Directory.FullName, "Plugins");
		foreach (string Old in new string[] { "AgentPanelBridge", "UEToVSLink" })
		{
			string Found = FindFile(Plugins, Old + ".uplugin");
			if (Found != null)
			{
				throw new Exception("UELink 已经包含 " + Old + " 的全部功能，项目里还留着旧插件：" + Path.GetDirectoryName(Found) +
					"。关掉编辑器，删掉这个目录（.uproject 的 Plugins 列表里有 " + Old + " 的话也一起删掉），再重新编译。");
			}
		}
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
		Console.WriteLine("UELink: 找到 UnLua（" + UnLuaDir + "），编进 Lua 支持；GetEnv(UObject)=" + bEnvByObject + " GetEnv()=" + bEnv + " GetState()=" + bGetState);
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
		// UnLua 常是改过的分支：可能放在 Plugins 的深层子目录、装在引擎里，或者 .uplugin 改了名，所以不认固定目录，
		// 按「文件名是 UnLua.uplugin，或插件里有 UnLua 模块」在整棵插件树里找（下面依赖的就是 UnLua 这个模块名）
		string Found = FindUnLuaPlugin(Path.Combine(ProjectDir, "Plugins"), 0);
		if (Found == null)
		{
			// 引擎里的插件要项目启用了才算，不然依赖一个没启用的模块 UBT 会直接报错
			string InEngine = FindUnLuaPlugin(Path.Combine(EngineDirectory, "Plugins"), 0);
			if (InEngine != null && EnabledForProject(Target.ProjectFile.FullName, InEngine))
			{
				Found = InEngine;
			}
		}
		return Found;
	}

	/** 插件目录里不会再套插件、又很大的子目录：扫引擎的插件树时跳过，几千个目录以内就扫完 */
	private static readonly HashSet<string> SkipDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
	{
		"Source", "Content", "Binaries", "Intermediate", "Resources", "Shaders", "Config", "Saved", "Extras", "ThirdParty", "Docs", ".git", ".svn"
	};

	/** 返回 UnLua 插件的目录（.uplugin 所在）；插件里还能套插件（官方仓库是 Plugins/UnLua/Plugins/UnLua），找到 .uplugin 也接着往下 */
	private static string FindUnLuaPlugin(string Dir, int Depth)
	{
		if (Depth > 8 || !Directory.Exists(Dir))
		{
			return null;
		}
		try
		{
			if (File.Exists(Path.Combine(Dir, "UnLua.uplugin")))
			{
				return Dir;
			}
			if (Directory.GetFiles(Dir, "*.uplugin").Length > 0 && File.Exists(Path.Combine(Dir, "Source", "UnLua", "UnLua.Build.cs")))
			{
				return Dir;
			}
			foreach (string Sub in Directory.GetDirectories(Dir))
			{
				if (SkipDirs.Contains(Path.GetFileName(Sub)))
				{
					continue;
				}
				string Found = FindUnLuaPlugin(Sub, Depth + 1);
				if (Found != null)
				{
					return Found;
				}
			}
		}
		catch (Exception)
		{
		}
		return null;
	}

	/** 引擎插件对这个项目开着没有：.uproject 里写了它的名字（没写 Enabled:false），或清单里 EnabledByDefault */
	private static bool EnabledForProject(string UProjectFile, string PluginDir)
	{
		try
		{
			string[] Manifests = Directory.GetFiles(PluginDir, "*.uplugin");
			if (Manifests.Length == 0)
			{
				return false;
			}
			string Name = Regex.Escape(Path.GetFileNameWithoutExtension(Manifests[0]));
			string UProject = File.ReadAllText(UProjectFile);
			if (Regex.IsMatch(UProject, "\"Name\"\\s*:\\s*\"" + Name + "\"", RegexOptions.IgnoreCase))
			{
				return !Regex.IsMatch(UProject, "\"Name\"\\s*:\\s*\"" + Name + "\"\\s*,\\s*\"Enabled\"\\s*:\\s*false", RegexOptions.IgnoreCase);
			}
			return Regex.IsMatch(File.ReadAllText(Manifests[0]), "\"EnabledByDefault\"\\s*:\\s*true");
		}
		catch (Exception)
		{
			return false;
		}
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
