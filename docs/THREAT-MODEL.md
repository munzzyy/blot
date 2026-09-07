# Blot threat model

What flattening guarantees, what it refuses, and what stays on you. Five
minutes here beats learning any of it from a leak.

## The guarantee, precisely

The output PDF holds raster images and the structure to display them.
That's the whole format. Blot's writer has no code paths for text,
fonts, annotations, forms, attachments, metadata, or incremental
updates, so none of those things can survive into the output no matter
what the input hid. Cleanup tools try to find and strip the dangerous
parts; construction doesn't have to find anything. Hidden layers, prior
versions, object streams, whatever: the output was built from pixels
alone.

I still check. The finished bytes get reopened, every page is asked for
its text and annotations, and the proof screen shows you the counts.
The test suite repeats those checks from outside the app using poppler,
a second PDF implementation that owes this one nothing.

## What the ink means

Ink is painted into the page image before the output encodes. There is no
rectangle object over text, no layer to remove, no "undo" living in the
file. What the covered pixels said is unrecoverable from the output.

Two cautions I'd rather over-state than under-state. Cover all of it: a
sliver of a name's ascenders can still be legible, and Blot has no idea
what you meant to hide. Zoom in, check your work; the editor shows the
same resolution the export uses. And remember that context leaks. An
inked box exactly the width of one word, in a template everyone knows,
narrows the guesses a lot. People who redact for a living think about
what the shape of the box gives away, not just what's under it.

## Why the refusals exist

Every refusal is a case where "do it anyway" has burned someone. A
password-protected file invites guessing at partial decryption, which is
how tools corrupt documents, so Blot asks you to unlock it first. Filled
forms and XFA keep their content outside the normal page stream where a
renderer can miss or misplace it, and redacting a page you can't trust
to be complete is exactly how the thing you meant to hide ships anyway;
print the form to a fresh PDF, look it over, then bring that here. A
signed document dies as a signed document the moment it's flattened, and
Blot won't quietly break the one property the file was issued for. And
the 60-page cap exists because every page lives in memory as an image,
browsers die quietly past a point, and a crash halfway through a
redaction session is worse than a stated limit.

## What Blot does not do

It does not read minds. A name in a paragraph you didn't ink ships in
the output, perfectly readable to anyone who looks, even though machines
extract nothing. The judgment about WHAT to hide is all yours. Blot's
job is narrower and harder to get wrong: making that judgment stick.

It does not anonymize style, layout, printer dots, or scanner artifacts.
A document can identify its origin through how it looks, not just what
it says.

It does not touch the input file. Your original stays wherever it was,
un-redacted; treat it accordingly.

## Where your document goes

Nowhere. The page loads its own files and opens no other connections;
the Android app has no INTERNET permission, so the OS enforces that. The
document lives in memory while you work and goes away when you close it.
The output goes exactly where you send it.

## What you're trusting

Mozilla's PDF.js to render the input faithfully, pinned, checksummed, and
run with eval disabled under a CSP that has no unsafe-eval and no network
origins. Blot's own writer and editor, a few hundred readable lines. And
your own eyes on the pages before you press export.

This whole page is what you're trusting, whichever shell it runs in: the
Android app, the iOS wrapper, or a plain browser tab. On Android the
network guarantee above is enforced by the OS itself, because the
manifest requests no `INTERNET` permission. iOS has no permission that
takes networking away from an app, so on the iOS wrapper the guarantee
rests one layer higher up: no networking code in the wrapper, plus this
same CSP. Full accounting of what else differs on iOS, including what has
and has not been verified on real hardware: `docs/IOS.md`.
