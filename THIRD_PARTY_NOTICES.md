# Third-Party Notices

Brmble uses the following third-party libraries.

## SoundTouch

License: LGPL 2.1

Source: https://codeberg.org/soundtouch/soundtouch

SoundTouch is used via the SoundTouch.Net managed NuGet port for time-stretching
in the voice receive pipeline (`src/Brmble.Audio/NetEQ/TimeStretcher.cs`).

Under LGPL 2.1 § 6, users retain the right to modify and relink the SoundTouch
portion of this software. The SoundTouch source remains available at the URL
above, and the library ships as a separately-linked assembly via NuGet.
