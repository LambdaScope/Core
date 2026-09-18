pub const SOURCE: &str = r#"
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define MAX_PATH_LEN 256

struct openat_event {
    __u32 pid;
    char pathname[MAX_PATH_LEN];
    __u32 flags;
    __u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} openat_events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *ctx) {
    struct openat_event event = {};
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.flags = ctx->args[2];
    event.timestamp_ns = bpf_ktime_get_ns();
    
    void *pathname_ptr = (void *)ctx->args[1];
    bpf_probe_read_user_str(event.pathname, MAX_PATH_LEN, pathname_ptr);
    
    bpf_perf_event_output(ctx, &openat_events, BPF_F_CURRENT_CPU,
                          &event, sizeof(event));
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
"#;
