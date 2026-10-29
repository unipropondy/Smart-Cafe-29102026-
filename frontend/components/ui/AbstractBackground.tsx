import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { Theme } from '../../constants/theme';

interface Props extends ViewProps {
  children?: React.ReactNode;
}

export default function AbstractBackground({ children, style, ...props }: Props) {
  return (
    <View style={[styles.container, style]} {...props}>
      <View style={styles.abstractBg}>
        <View style={styles.blob1} />
        <View style={styles.blob2} />
        <View style={styles.blob3} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.primary,
  },
  abstractBg: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  blob1: {
    position: "absolute",
    width: 600,
    height: 600,
    borderRadius: 300,
    backgroundColor: "rgba(255,255,255,0.08)",
    top: -200,
    left: -200,
  },
  blob2: {
    position: "absolute",
    width: 800,
    height: 800,
    borderRadius: 400,
    backgroundColor: "rgba(0,0,0,0.04)",
    bottom: -300,
    right: -200,
  },
  blob3: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: "30%",
    right: -100,
  },
});
