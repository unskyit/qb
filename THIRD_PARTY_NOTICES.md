# Third-Party Notices & Licenses

QuadBeam is licensed under the MIT License and bundles zero external runtime CDN dependencies. All runtime code and fonts included in the production distribution are covered by permissive open-source licenses documented below:

## 1. QRCode for JavaScript (Adapted ISO/IEC 18004 Polynomial & RS Block Tables)
- **Component**: `src/sender/qr-generator.js` (Reed-Solomon block tables, alignment pattern coordinate tables, and mask penalty rules adapted and modernized for ES2022 + Base45 Alphanumeric Mode)
- **Original Author**: Copyright (c) 2009 Kazuhiko Arase (`http://www.d-project.com/`)
- **License**: MIT License
  ```text
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.
  ```
- **Trademark Notice**: The word "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## 2. Inter Typeface (Locally Bundled WOFF2 Fonts)
- **Files**: `public/fonts/Inter-Regular.woff2`, `Inter-Medium.woff2`, `Inter-SemiBold.woff2`, `Inter-Bold.woff2`
- **Author**: Copyright (c) 2016-2022 The Inter Project Authors (Rasmus Andersson)
- **License**: SIL Open Font License 1.1 (OFL-1.1)

## 3. Inline SVG Icons (Feather / Lucide Inspired Geometry)
- **Component**: Inline SVG icons in `src/ui/` and `index.html`
- **License**: ISC / MIT License
