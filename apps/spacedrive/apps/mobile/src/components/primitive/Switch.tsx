import React, { FC } from "react";
import { Switch as RNSwitch, SwitchProps, Text, View } from "react-native";
import { role } from "~/theme/roles";

export const Switch: FC<SwitchProps> = (props) => {
	return (
		<RNSwitch
			trackColor={{
				false: role.surfaceContainerHighest,
				true: role.primary,
			}}
			thumbColor={props.value ? role.onPrimary : role.outline}
			ios_backgroundColor={role.surfaceContainerHighest}
			{...props}
		/>
	);
};

interface SwitchContainerProps extends SwitchProps {
	title: string;
	description?: string;
}

export const SwitchContainer: FC<SwitchContainerProps> = ({
	title,
	description,
	...props
}) => {
	return (
		<View className="flex-row items-center justify-between py-3">
			<View className="flex-1 pr-4">
				<Text className="text-sm font-medium text-ink">{title}</Text>
				{description && (
					<Text className="mt-1 text-sm text-ink-dull">
						{description}
					</Text>
				)}
			</View>
			<Switch {...props} />
		</View>
	);
};
