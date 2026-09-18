pub const SOURCE: &str = r#"
#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <linux/in.h>

struct connect_event {
    __u32 pid;
    __u32 fd;
    __u32 addr;
    __u16 port;
    __u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} connect_events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_connect")
int trace_connect(struct trace_event_raw_sys_enter *ctx) {
    struct connect_event event = {};
    struct sockaddr_in addr = {};
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.fd = ctx->args[0];
    event.timestamp_ns = bpf_ktime_get_ns();
    
    void *addr_ptr = (void *)ctx->args[1];
    bpf_probe_read_user(&addr, sizeof(addr), addr_ptr);
    
    event.addr = addr.sin_addr.s_addr;
    event.port = __builtin_bswap16(addr.sin_port);
    
    bpf_perf_event_output(ctx, &connect_events, BPF_F_CURRENT_CPU,
                          &event, sizeof(event));
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
"#;
