import * as Tone from "tone";
import { SampleLibrary } from "@stellarogs/tonejs-instruments";

if (!window.Tone) {
  window.Tone = Tone;
}
if (!window.SampleLibrary) {
  window.SampleLibrary = SampleLibrary;
}
