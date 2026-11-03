import { Platform } from 'react-native';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { role } from "~/theme/roles";

export default function TabLayout() {
  return (
    <NativeTabs
      // CRITICAL: null background enables liquid glass on iOS!
      backgroundColor={Platform.OS === 'ios' ? null : role.surfaceContainerLowest}
      disableTransparentOnScrollEdge={true}
      iconColor={Platform.OS === 'android' ? role.onSurfaceVariant : undefined}
      labelStyle={Platform.OS === 'android' ? {
        color: role.onSurfaceVariant
      } : undefined}
    >
      <NativeTabs.Trigger name="overview">
        <Label>Overview</Label>
        {Platform.OS === 'ios' ? (
          <Icon sf="square.grid.2x2" />
        ) : (
          <Icon name="grid" />
        )}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="browse">
        <Label>Browse</Label>
        {Platform.OS === 'ios' ? (
          <Icon sf="folder" />
        ) : (
          <Icon name="folder" />
        )}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <Label>Settings</Label>
        {Platform.OS === 'ios' ? (
          <Icon sf="gearshape" />
        ) : (
          <Icon name="settings" />
        )}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
