import React from "react";
import { ScrollViewStyleReset } from "expo-router/html";

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Set viewport correctly to prevent scaling/zooming issues in WebView */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <meta name="theme-color" content="#FF8C00" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Smart POS" />
        <link rel="manifest" href="/manifest.json" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: htmlStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const htmlStyles = `
@font-face {
  font-family: 'ionicons';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/Ionicons.ttf') format('truetype');
}
@font-face {
  font-family: 'Ionicons';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/Ionicons.ttf') format('truetype');
}
@font-face {
  font-family: 'material-community';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/MaterialCommunityIcons.ttf') format('truetype');
}
@font-face {
  font-family: 'Material Community Icons';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/MaterialCommunityIcons.ttf') format('truetype');
}
@font-face {
  font-family: 'FontAwesome5Free-Solid';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/FontAwesome5_Solid.ttf') format('truetype');
}
@font-face {
  font-family: 'FontAwesome5Free-Regular';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/FontAwesome5_Regular.ttf') format('truetype');
}
@font-face {
  font-family: 'FontAwesome5Brands-Regular';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/FontAwesome5_Brands.ttf') format('truetype');
}
@font-face {
  font-family: 'feather';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/Feather.ttf') format('truetype');
}
@font-face {
  font-family: 'Feather';
  src: url('https://unpkg.com/react-native-vector-icons@10.2.0/Fonts/Feather.ttf') format('truetype');
}
body {
  background-color: #F8F9FA;
  margin: 0;
  padding: 0;
}
input:focus,
textarea:focus,
input,
textarea {
  outline: none !important;
  box-shadow: none !important;
}
`;
