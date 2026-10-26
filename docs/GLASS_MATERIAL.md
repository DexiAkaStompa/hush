# Glass materials

Liquid Glass and Frosted Glass use neutral charcoal surfaces without generated
colored backgrounds. Their control geometry is shared with the opaque themes.

In the desktop app, the renderer requests a native backdrop only for these two
themes. Windows 11 22H2 or later uses DWM Acrylic; macOS uses under-window vibrancy.
Windows uses a regular composited window rather than a layered transparent window,
so resizing and maximizing do not depend on layered-window transparency support.
The document becomes transparent only after the main process acknowledges success.
Theme changes and reduced-transparency/contrast preferences turn the material off.
The IPC accepts only a boolean from the trusted main frame.

Browsers, older Windows versions, Linux and compositor failures retain an opaque
neutral background. CSS backdrop blur cannot blur other applications or the desktop.
Liquid Glass adds a clear optical material inspired by the supplied Tahoe
component. On desktop Chromium, small surfaces use a rounded-edge displacement
map and an SVG backdrop filter. The circular bezel falloff bends background
light near the rim, while text and icons remain unfiltered. The platform backdrop
still comes from DWM/Vibrancy; this is not Apple's native renderer.

The optical module loads only for Liquid Glass. It owns at most 12 live filters,
caps map resolution at 384×256, skips large panes, avoids nested lenses and
rebuilds maps only after size changes. There is no idle animation loop. Menus
mounted through portals are discovered automatically and release their filters
when removed. Theme changes dispose observers, maps, filters and pointer state.
Touch devices and non-Chromium engines use the lighter CSS material. Reduced
transparency or increased contrast removes refraction and uses solid surfaces;
reduced motion disables pointer highlights and press motion.

Frosted Glass retains its existing tokens and styling. All new selectors target
Liquid Glass. Liquid Glass is first in the theme list and the default when no
valid preference exists; Hush Void is last. Existing saved choices are preserved.

Text fields use a subtle focused border without an outer glow. Composer textareas
have no separate focus outline; their container indicates focus. Keyboard actions
keep a thin neutral focus outline.

References:
- https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows
- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations
- https://developer.apple.com/design/human-interface-guidelines/materials
