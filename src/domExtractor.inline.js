/**
 * @file DOM 提取工具 - Inline Bookmarklet 版本
 * @description 将此文件内容压缩后可直接嵌入 javascript: URL 使用
 *
 * 使用方法：
 * 1. 将下面的代码压缩（去除空格、换行）
 * 2. 添加 javascript: 前缀
 * 3. 创建书签，URL 填入压缩后的代码
 */

(function(){
    /*===配置===*/
    var HIGHLIGHT=true;
    var HIGHLIGHT_ID='dext-hl';

    /*===清除旧高亮===*/
    document.getElementById(HIGHLIGHT_ID)?.remove();

    /*===核心提取===*/
    var idx=0,MAP={},ID=0;

    function isInt(el){
        var t=el.tagName.toLowerCase();
        if(['a','button','input','select','textarea'].includes(t)&&!el.disabled)return 1;
        var s=getComputedStyle(el);
        return s.cursor=='pointer'||el.hasAttribute('onclick');
    }

    function isVis(el){return el.offsetWidth>0&&el.offsetHeight>0;}

    function hl(el,i){
        if(!HIGHLIGHT)return;
        var c=document.getElementById(HIGHLIGHT_ID);
        if(!c){
            c=document.createElement('div');
            c.id=HIGHLIGHT_ID;
            c.style.cssText='position:fixed;pointer-events:none;top:0;left:0;width:100%;height:100%;z-index:2147483640';
            document.body.appendChild(c);
        }
        var r=el.getClientRects()[0];
        if(!r)return;
        var colors=['#F00','#0F0','#00F','#F80','#80F'];
        var col=colors[i%5];
        var d=document.createElement('div');
        d.style.cssText='position:fixed;border:2px solid '+col+';background:'+col+'1a;pointer-events:none;top:'+r.top+'px;left:'+r.left+'px;width:'+r.width+'px;height:'+r.height+'px';
        c.appendChild(d);
        var lb=document.createElement('div');
        lb.style.cssText='position:fixed;background:'+col+';color:white;padding:2px 6px;border-radius:4px;font-size:12px;top:'+r.top+'px;left:'+r.left+'px';
        lb.textContent=i;
        c.appendChild(lb);
    }

    function build(n,ph){
        if(!n||n.id==HIGHLIGHT_ID)return null;
        if(n.nodeType==3){
            var t=n.textContent.trim();
            if(t.length<2)return null;
            MAP[ID++]={type:'T',text:t};
            return 1;
        }
        if(n.nodeType!=1)return null;
        var tag=n.tagName.toLowerCase();
        if(['svg','script','style','link','meta'].includes(tag))return null;

        var nd={tag:tag,ref:n,children:[]};
        if(isVis(n)){
            nd.int=isInt(n);
            var sh=nd.int&&!ph||['a','button','input'].includes(tag);
            if(sh){
                nd.idx=idx;
                hl(n,idx);
                idx++;
            }
        }
        for(var c of n.childNodes)build(c,nd.idx!=null);
        MAP[ID++]=nd;
        return 1;
    }

    build(document.body,0);

    /*===辅助函数===*/
    window.getInt=function(){
        return Object.entries(MAP)
            .filter(([i,n])=>n.int&&n.idx!=null)
            .map(([i,n])=>({idx:n.idx,tag:n.tag,text:(n.ref?.innerText||'').slice(0,50),ref:n.ref}))
            .sort((a,b)=>a.idx-b.idx);
    };

    window.findByText=function(t){
        for(var [i,n] of Object.entries(MAP))if(n.ref?.innerText?.includes(t))return n;
        return null;
    };

    window.findByIdx=function(i){
        for(var [id,n] of Object.entries(MAP))if(n.idx==i)return n;
        return null;
    };

    window.clearHl=function(){document.getElementById(HIGHLIGHT_ID)?.remove()};

    /*===输出结果===*/
    var int=getInt();
    console.log('%c🛵 DOM提取完成','color:#667eea;font-size:16px;font-weight:bold');
    console.log('总节点:'+Object.keys(MAP).length+' 可交互:'+int.length);
    console.table(int);
    window._DM=MAP;
    window._INT=int;
})();