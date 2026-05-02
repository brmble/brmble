using Brmble.Audio;
using Brmble.Audio.Tests.Helpers;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests;

[TestClass]
public class VadGateTests
{
    private static VadGateConfig BalancedConfig => VadGateConfig.FromSensitivity(VadSensitivity.Balanced);

    [TestMethod]
    public void Closed_to_Open_requires_VadTrue_AND_RmsAboveOpen()
    {
        var vad = new FakeVadDetector(true);
        var gate = new VadGate(vad, BalancedConfig);

        var decision = gate.Process(FrameFactory.WithRms(500), nowMs: 0);

        Assert.IsInstanceOfType(decision, typeof(GateDecision.OpenWithLookback));
    }

    [TestMethod]
    public void Closed_stays_Closed_when_VadFalse_even_if_RmsHigh()
    {
        var vad = new FakeVadDetector(false);
        var gate = new VadGate(vad, BalancedConfig);

        var decision = gate.Process(FrameFactory.WithRms(2000), nowMs: 0);

        Assert.IsInstanceOfType(decision, typeof(GateDecision.Stay));
    }

    [TestMethod]
    public void Closed_stays_Closed_when_RmsBelowOpen_even_if_VadTrue()
    {
        var vad = new FakeVadDetector(true);
        var gate = new VadGate(vad, BalancedConfig);

        var decision = gate.Process(FrameFactory.WithRms(100), nowMs: 0);

        Assert.IsInstanceOfType(decision, typeof(GateDecision.Stay));
    }

    [TestMethod]
    public void OpenWithLookback_includes_OnsetLookbackFrames_plus_one_frames()
    {
        var vad = new FakeVadDetector(false, false, false, true);
        var gate = new VadGate(vad, BalancedConfig);

        // Three sub-threshold frames (Stay)
        gate.Process(FrameFactory.WithRms(50),  0);
        gate.Process(FrameFactory.WithRms(50), 10);
        gate.Process(FrameFactory.WithRms(50), 20);
        // Fourth frame opens the gate
        var decision = gate.Process(FrameFactory.WithRms(500), 30);

        var open = (GateDecision.OpenWithLookback)decision;
        Assert.AreEqual(3, open.Frames.Count);
    }

    [TestMethod]
    public void Open_stays_Open_during_brief_VadFalse_within_hangover()
    {
        var vad = new FakeVadDetector(true, false, true);
        var gate = new VadGate(vad, BalancedConfig);

        gate.Process(FrameFactory.WithRms(500),   0);  // open
        var dipDecision = gate.Process(FrameFactory.WithRms(500), 50);  // VAD says false but within hangover

        Assert.IsInstanceOfType(dipDecision, typeof(GateDecision.PassThrough));
    }

    [TestMethod]
    public void Open_closes_after_hangover_with_no_activity()
    {
        var vad = new FakeVadDetector(true, false, false);
        var gate = new VadGate(vad, BalancedConfig);

        gate.Process(FrameFactory.WithRms(500),   0);    // open at t=0
        gate.Process(FrameFactory.WithRms(500), 100);    // VAD=false, still in hangover (300 ms)
        var closeDecision = gate.Process(FrameFactory.WithRms(500), 400);  // VAD=false, hangover elapsed

        Assert.IsInstanceOfType(closeDecision, typeof(GateDecision.CloseWithTerminator));
    }

    [TestMethod]
    public void Open_does_not_close_when_RmsAboveClose_even_if_VadFalse_briefly()
    {
        var vad = new FakeVadDetector(true, false, true, false);
        var gate = new VadGate(vad, BalancedConfig);

        gate.Process(FrameFactory.WithRms(500),   0);  // open
        gate.Process(FrameFactory.WithRms(500), 100); // VAD false, RMS high — hangover does NOT reset
        gate.Process(FrameFactory.WithRms(500), 200); // VAD true, RMS high — hangover RESETS here
        var d = gate.Process(FrameFactory.WithRms(500), 450); // VAD false, but only 250ms since last reset (<300)

        Assert.IsInstanceOfType(d, typeof(GateDecision.PassThrough));
    }

    [TestMethod]
    public void After_Close_subsequent_belowThreshold_frames_return_Stay_not_Close()
    {
        var vad = new FakeVadDetector(true, false, false, false);
        var gate = new VadGate(vad, BalancedConfig);

        gate.Process(FrameFactory.WithRms(500),   0);   // open
        gate.Process(FrameFactory.WithRms(500), 400);   // close (1st CloseWithTerminator)
        var d = gate.Process(FrameFactory.WithRms(50), 500); // closed already

        Assert.IsInstanceOfType(d, typeof(GateDecision.Stay));
    }

    [TestMethod]
    public void SetSensitivity_changes_thresholds_for_next_frame()
    {
        var vad = new FakeVadDetector(true, true);
        var gate = new VadGate(vad, VadGateConfig.FromSensitivity(VadSensitivity.High)); // open=400

        var d1 = gate.Process(FrameFactory.WithRms(300), 0);
        Assert.IsInstanceOfType(d1, typeof(GateDecision.Stay), "RMS 300 < open 400 in High");

        gate.SetSensitivity(VadSensitivity.Balanced); // open=250
        var d2 = gate.Process(FrameFactory.WithRms(300), 10);
        Assert.IsInstanceOfType(d2, typeof(GateDecision.OpenWithLookback), "RMS 300 >= open 250 in Balanced");
    }

    [TestMethod]
    [ExpectedException(typeof(ArgumentException))]
    public void Process_throws_on_wrong_frame_length()
    {
        var gate = new VadGate(new FakeVadDetector(), BalancedConfig);
        gate.Process(new short[100], 0);
    }
}
