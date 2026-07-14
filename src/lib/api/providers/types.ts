import type {
	CallApiResult,
	InputImage,
	MaskDraft,
	NativeJsonRequest,
	NativeMultipartRequest,
	TaskParams
} from '$lib/domain/types';
import type {
	ApiProfile,
	AppSettings,
	BuiltInImageApiProtocol,
	CustomProviderPollMapping,
	CustomProviderSubmitMapping
} from '$lib/domain/settings';

export type ProviderNativeRequest =
	| {
			kind: 'json';
			request: NativeJsonRequest;
			parse: (payload: unknown) => CallApiResult;
			customAsync?: {
				submit: CustomProviderSubmitMapping;
				poll: CustomProviderPollMapping;
			};
	  }
	| {
			kind: 'multipart';
			request: NativeMultipartRequest;
			parse: (payload: unknown) => CallApiResult;
			customAsync?: {
				submit: CustomProviderSubmitMapping;
				poll: CustomProviderPollMapping;
			};
	  };

export interface ProviderRequestGroup {
	provider: string;
	requests: ProviderNativeRequest[];
}

export interface BuildProviderRequestGroupInput {
	settings: AppSettings;
	profile: ApiProfile;
	prompt: string;
	params: TaskParams;
	inputImages: InputImage[];
	mask: MaskDraft | null;
}

export interface BuiltInImageProtocolAdapter {
	id: BuiltInImageApiProtocol;
	resolveEndpoint(profile: ApiProfile, operation: 'generate' | 'edit'): string;
	buildRequestGroup(input: BuildProviderRequestGroupInput): ProviderRequestGroup;
}
