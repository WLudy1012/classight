using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.CompilerServices;
using Classight.Class;
using Classight.Identity;
using Classight.Platform;
using Xunit;

namespace Classight.IntegrationTests;

public sealed class PluginContractTests
{
    public class Payload
    {
        public string Value { get; set; } = "plugin audit";
    }

    [Fact]
    public void Core_business_assemblies_do_not_reference_optional_plugin_implementations()
    {
        string[] optional = ["Classight.Captcha", "Classight.Timetable", "Classight.MemberIdentity", "Classight.Speech"];
        Assert.DoesNotContain(typeof(IdentityModule).Assembly.GetReferencedAssemblies(), item => optional.Contains(item.Name));
        Assert.DoesNotContain(typeof(ClassModule).Assembly.GetReferencedAssemblies(), item => optional.Contains(item.Name));
    }

    [Fact]
    public void Audit_serialization_does_not_keep_collectible_plugin_payload_types_alive()
    {
        var control = SerializeCollectiblePayload(false);
        Collect(control);
        Assert.False(control.IsAlive);
        var reference = SerializeCollectiblePayload(true);
        Collect(reference);
        Assert.False(reference.IsAlive);
    }

    private static void Collect(WeakReference reference)
    {
        for (var attempt = 0; reference.IsAlive && attempt < 20; attempt++)
        {
            Thread.Sleep(100);
            JsonDefaults.Serialize(new Payload());
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference SerializeCollectiblePayload(bool serialize)
    {
        var assembly = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("PluginPayload" + Guid.NewGuid().ToString("N")), AssemblyBuilderAccess.RunAndCollect);
        var module = assembly.DefineDynamicModule("Plugin");
        var type = module.DefineType("PluginPayload", TypeAttributes.Public, typeof(Payload)).CreateType()!;
        var payload = Activator.CreateInstance(type)!;
        if (serialize) Assert.Contains("plugin audit", JsonDefaults.Serialize(payload));
        return new WeakReference(type);
    }
}
