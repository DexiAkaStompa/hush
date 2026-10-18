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
This is a glass approximation using supported platform materials, not Apple's
native Liquid Glass renderer or optical refraction.

Text fields use a subtle focused border without an outer glow. Composer textareas
have no separate focus outline; their container indicates focus. Keyboard actions
keep a thin neutral focus outline.

References:
- https://www.electronjs.org/docs/latest/api/browser-window#winsetbackgroundmaterialmaterial-windows
- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations
- https://developer.apple.com/design/human-interface-guidelines/materials
